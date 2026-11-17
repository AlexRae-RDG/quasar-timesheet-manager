//! Jira "QDM" search -- Sub-tasks assigned to the current user that can be
//! imported as Activities. Quality Assurance's live in a single project
//! (QDM -- `search_qdms`); Accreditation's are spread across many Jira
//! projects, so they're found through the "Accreditation Delivery" epics
//! instead (`search_accreditation_tasks`). Ported from the Python app's main_window.py
//! `_open_jira_api_import` / jira_client.search_issues, which already
//! called Jira's own search API directly rather than going through a CSV
//! round-trip -- same JQL shape, same endpoint. Also fetches each QDM's
//! parent issue's summary (not part of the original port), so the frontend
//! can guess which internal Project a QDM belongs to from its parent's name.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

use crate::jira::{normalize_site_url, truncate};

// Closed QDMs are included deliberately -- the frontend routes them into an
// "Archived" Project instead of wherever their parent epic would otherwise
// suggest, so old work stays out of the way but is still re-enable-able
// later rather than lost by never being imported at all. `{project_key}` is
// filled in by build_jql -- QDM for Quality Assurance, TISACC for
// Accreditation -- so this same query shape works for either team's project.
const QDM_JQL_TEMPLATE: &str = r#"project = {project_key} AND assignee = currentUser() AND type = Sub-task AND status IN ("In Progress", Pipeline, Closed) ORDER BY cf[10116] ASC"#;
const MAX_RESULTS_PER_PAGE: u32 = 100;
// A generous ceiling, not a real-world limit -- guards a long-running IPC
// call against pathological pagination rather than reflecting any expected
// QDM count.
const MAX_TOTAL_RESULTS: usize = 500;

// Accreditation: epics are found by name (Jira's `~` is a word match, so the
// results are re-checked against this exact phrase afterwards), then their
// stories, then the current user's sub-tasks under those stories. Statuses
// are the QDM query's plus "Open" (Accreditation's projects have tasks that
// haven't been started yet) and "Archive" (finished work, shown on the
// import dialog's Archived tab alongside Closed); QDM's workflow has neither.
const ACCREDITATION_EPIC_NAME: &str = "Accreditation Delivery";
const ACCREDITATION_STATUSES: &str = r#"(Open, "In Progress", Pipeline, Closed, Archive)"#;
// Accreditation also works from one whole Jira project, "TISACC RDG Admin",
// where every Sub-task assigned to the user counts (no "Accreditation
// Delivery" epic involved -- its work items hang off a single "TISACC Team
// Admin and RDG Delivery" epic, one per team member, and time is logged on
// the sub-tasks under those).
const EXTRA_PROJECT_KEYS: [&str; 1] = ["TISACC"];
// Stories can't be filtered by assignee (the user is assigned the sub-task,
// not necessarily the story), so this has to allow for every story in every
// matching epic -- far above any expected count.
const MAX_STORIES: usize = 3000;
// Keys per `parent in (...)` query -- keeps the JQL a sane length.
const KEYS_PER_QUERY: usize = 50;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QdmResult {
    pub jira_key: String,
    pub summary: String,
    /// The sub-task's direct parent issue's own summary (e.g. "Railcards QA
    /// Delivery") -- each QDM's parent is the one issue per delivery track,
    /// so its name is what the frontend uses to guess which internal
    /// Project this QDM belongs to. None on the rare issue with no parent.
    pub parent_summary: Option<String>,
    /// One of "In Progress", "Pipeline", or "Closed" (plus "Open" and
    /// "Archive" for Accreditation tasks) -- constrained by
    /// QDM_JQL's own status filter above. The frontend treats "Closed"
    /// specially (routes to an Archived Project) rather than by parent name.
    pub status: String,
    /// Accreditation only: the summary of the "Accreditation Delivery" epic
    /// this sub-task's story belongs to (parent_summary is the story's).
    /// None for QDMs, whose parent is the top of the hierarchy.
    pub epic_summary: Option<String>,
    /// Accreditation's whole-project tickets only: the display name of the
    /// Jira project the ticket is in, used as the Project-name guess since
    /// there's no epic. None for everything else.
    pub jira_project_name: Option<String>,
}

#[derive(Deserialize)]
struct SearchResponse {
    issues: Vec<Issue>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct Issue {
    key: String,
    fields: IssueFields,
}

#[derive(Deserialize)]
struct IssueFields {
    summary: Option<String>,
    parent: Option<ParentRef>,
    status: StatusRef,
    project: Option<ProjectRef>,
}

#[derive(Deserialize)]
struct ProjectRef {
    name: String,
}

#[derive(Deserialize)]
struct ParentRef {
    key: String,
    fields: ParentFields,
}

#[derive(Deserialize)]
struct ParentFields {
    summary: Option<String>,
}

#[derive(Deserialize)]
struct StatusRef {
    name: String,
}

struct Conn<'a> {
    client: Client,
    site: String,
    site_url: &'a str,
    email: &'a str,
    token: &'a str,
}

fn connect<'a>(site_url: &'a str, email: &'a str, token: &'a str) -> Result<Conn<'a>, String> {
    let site = normalize_site_url(site_url);
    if site.is_empty() {
        return Err("Enter a Jira Site URL first.".to_string());
    }
    if email.trim().is_empty() {
        return Err("Enter your Jira account Email first.".to_string());
    }
    Ok(Conn { client: Client::new(), site, site_url, email, token })
}

/// Runs one JQL query to completion (following nextPageToken) and returns
/// the issues, up to `max_total`. Shared by the QDM and Accreditation
/// searches. Always asks for summary / parent / status.
async fn jql_search(conn: &Conn<'_>, jql: &str, max_total: usize) -> Result<Vec<Issue>, String> {
    // /search/jql is Jira Cloud's current issue-search endpoint (the older
    // /search was deprecated) -- cursor-paginated via nextPageToken, no
    // isLast/total field to check instead.
    let url = format!("{}/rest/api/3/search/jql", conn.site);
    let mut issues = Vec::new();
    let mut page_token: Option<String> = None;
    let mut page_num = 0;

    eprintln!("[qdm] jql={jql}");

    loop {
        page_num += 1;
        let mut body = serde_json::json!({
            "jql": jql,
            "maxResults": MAX_RESULTS_PER_PAGE,
            "fields": ["summary", "parent", "status", "project"],
        });
        if let Some(t) = &page_token {
            body["nextPageToken"] = serde_json::Value::String(t.clone());
        }

        let resp = conn
            .client
            .post(&url)
            .basic_auth(conn.email, Some(conn.token))
            .header("Accept", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| {
                eprintln!("[qdm] page {page_num} request failed: {e}");
                format!("Couldn't reach {} -- {e}", conn.site_url)
            })?;

        let status = resp.status();
        let headers = resp.headers().clone();
        eprintln!("[qdm] page {page_num} response: HTTP {status}");
        for (name, value) in headers.iter() {
            eprintln!("[qdm]   header {name}: {}", value.to_str().unwrap_or("<non-utf8>"));
        }

        let raw_body = resp.text().await.unwrap_or_default();
        eprintln!("[qdm] page {page_num} body ({} bytes): {}", raw_body.len(), truncate(raw_body.trim(), 500));

        if !status.is_success() {
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err("Jira rejected these credentials -- check your Email and API Token.".to_string());
            }
            return Err(format!(
                "HTTP {status} from Jira while searching. {}",
                truncate(raw_body.trim(), 200)
            ));
        }

        let data: SearchResponse = serde_json::from_str(&raw_body)
            .map_err(|e| format!("Unexpected response from Jira -- {e}"))?;

        eprintln!("[qdm] page {page_num} parsed {} issue(s), nextPageToken={:?}", data.issues.len(), data.next_page_token);

        issues.extend(data.issues);

        if issues.len() >= max_total {
            break;
        }
        match data.next_page_token {
            Some(t) => page_token = Some(t),
            None => break,
        }
    }

    Ok(issues)
}

pub async fn search_qdms(
    site_url: &str,
    email: &str,
    token: &str,
    project_key: &str,
) -> Result<Vec<QdmResult>, String> {
    let conn = connect(site_url, email, token)?;
    let project_key = if project_key.trim().is_empty() { "QDM" } else { project_key.trim() };
    let jql = QDM_JQL_TEMPLATE.replace("{project_key}", project_key);

    // Temporary diagnostics for a "no error, but zero results" report that
    // only reproduces on one particular Windows machine (identical
    // account/token/JQL works fine elsewhere) -- goes to this dev process's
    // own stdout/stderr, which a packaged release never shows a console
    // for, so this is harmless to leave in rather than something to remember
    // to strip out later. Never logs the token itself.
    eprintln!("[qdm] site={} email={email} project_key={project_key}", conn.site);

    let issues = jql_search(&conn, &jql, MAX_TOTAL_RESULTS).await?;
    let results: Vec<QdmResult> = issues
        .into_iter()
        .map(|issue| QdmResult {
            jira_key: issue.key,
            summary: issue.fields.summary.unwrap_or_default(),
            parent_summary: issue.fields.parent.and_then(|p| p.fields.summary),
            status: issue.fields.status.name,
            epic_summary: None,
            jira_project_name: None,
        })
        .collect();

    eprintln!("[qdm] total results: {}", results.len());
    Ok(results)
}

/// Accreditation's equivalent of `search_qdms`. Their work is spread across
/// many Jira projects (different names and keys), but it all sits under
/// epics whose name contains "Accreditation Delivery" -- epic > story >
/// sub-task, with time logged against the sub-task. JQL can't walk two
/// levels of hierarchy in one query, so this runs three: epics by name,
/// those epics' stories, then the current user's sub-tasks under those
/// stories (same status filter as QDM). Nothing is configured per project,
/// so a new Accreditation project or epic is picked up automatically.
pub async fn search_accreditation_tasks(
    site_url: &str,
    email: &str,
    token: &str,
) -> Result<Vec<QdmResult>, String> {
    let conn = connect(site_url, email, token)?;
    eprintln!("[qdm] site={} email={email} mode=accreditation", conn.site);

    // 1. Epics. `~` matches words, not the exact phrase, so keep only the
    // ones whose name really contains it.
    let epic_jql = format!(r#"issuetype = Epic AND summary ~ "{ACCREDITATION_EPIC_NAME}""#);
    let phrase = ACCREDITATION_EPIC_NAME.to_lowercase();
    let epics: HashMap<String, String> = jql_search(&conn, &epic_jql, MAX_TOTAL_RESULTS)
        .await?
        .into_iter()
        .filter_map(|e| {
            let summary = e.fields.summary.unwrap_or_default();
            summary.to_lowercase().contains(&phrase).then_some((e.key, summary))
        })
        .collect();
    eprintln!("[qdm] matched {} epic(s)", epics.len());
    if epics.is_empty() {
        return Err(format!(
            "No epics with \"{ACCREDITATION_EPIC_NAME}\" in their name were found in Jira."
        ));
    }

    // 2. Stories directly under those epics: story key -> (summary, epic key).
    let mut epic_keys: Vec<&String> = epics.keys().collect();
    epic_keys.sort();
    let mut stories: HashMap<String, (String, String)> = HashMap::new();
    for chunk in epic_keys.chunks(KEYS_PER_QUERY) {
        let jql = format!("parent in ({})", join_keys(chunk));
        for story in jql_search(&conn, &jql, MAX_STORIES).await? {
            let epic_key = story.fields.parent.map(|p| p.key).unwrap_or_default();
            stories.insert(story.key, (story.fields.summary.unwrap_or_default(), epic_key));
        }
    }
    eprintln!("[qdm] found {} stor(ies)", stories.len());

    // 3. The current user's sub-tasks under those stories.
    let mut story_keys: Vec<&String> = stories.keys().collect();
    story_keys.sort();
    let mut results = Vec::new();
    for chunk in story_keys.chunks(KEYS_PER_QUERY) {
        let jql = format!(
            "assignee = currentUser() AND type = Sub-task AND parent in ({}) AND status IN {ACCREDITATION_STATUSES}",
            join_keys(chunk)
        );
        for issue in jql_search(&conn, &jql, MAX_TOTAL_RESULTS).await? {
            let (story_key, story_summary) = match &issue.fields.parent {
                Some(p) => (p.key.as_str(), p.fields.summary.clone()),
                None => ("", None),
            };
            let (map_summary, epic_key) = stories
                .get(story_key)
                .map(|(s, e)| (Some(s.clone()), e.as_str()))
                .unwrap_or((None, ""));
            results.push(QdmResult {
                jira_key: issue.key,
                summary: issue.fields.summary.unwrap_or_default(),
                parent_summary: story_summary.or(map_summary),
                status: issue.fields.status.name,
                epic_summary: epics.get(epic_key).cloned(),
                jira_project_name: None,
            });
        }
    }

    // 4. Sub-tasks assigned to the user in the extra whole project(s).
    let jql = format!(
        "project in ({}) AND assignee = currentUser() AND type = Sub-task AND status IN {ACCREDITATION_STATUSES}",
        EXTRA_PROJECT_KEYS.join(", ")
    );
    let seen: HashSet<String> = results.iter().map(|r| r.jira_key.clone()).collect();
    for issue in jql_search(&conn, &jql, MAX_TOTAL_RESULTS).await? {
        // Already found through an epic (it has the better Project guess).
        if seen.contains(&issue.key) {
            continue;
        }
        results.push(QdmResult {
            jira_key: issue.key,
            summary: issue.fields.summary.unwrap_or_default(),
            parent_summary: issue.fields.parent.and_then(|p| p.fields.summary),
            status: issue.fields.status.name,
            epic_summary: None,
            jira_project_name: issue.fields.project.map(|p| p.name),
        });
    }

    eprintln!("[qdm] total accreditation results: {}", results.len());
    Ok(results)
}

fn join_keys(keys: &[&String]) -> String {
    keys.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", ")
}

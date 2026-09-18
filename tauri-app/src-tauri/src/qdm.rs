//! Jira "QDM" search -- Sub-tasks in a team's delivery-management project
//! (QDM for Quality Assurance, TISACC for Accreditation -- see
//! settings::AppSettings.department and the frontend's
//! projectKeyForDepartment), assigned to the current user, that can be
//! imported as Activities. Ported from the Python app's main_window.py
//! `_open_jira_api_import` / jira_client.search_issues, which already
//! called Jira's own search API directly rather than going through a CSV
//! round-trip -- same JQL shape, same endpoint. Also fetches each QDM's
//! parent issue's summary (not part of the original port), so the frontend
//! can guess which internal Project a QDM belongs to from its parent's name.

use reqwest::Client;
use serde::{Deserialize, Serialize};
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
    /// One of "In Progress", "Pipeline", or "Closed" -- constrained by
    /// QDM_JQL's own status filter above. The frontend treats "Closed"
    /// specially (routes to an Archived Project) rather than by parent name.
    pub status: String,
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
}

#[derive(Deserialize)]
struct ParentRef {
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

pub async fn search_qdms(
    site_url: &str,
    email: &str,
    token: &str,
    project_key: &str,
) -> Result<Vec<QdmResult>, String> {
    let site = normalize_site_url(site_url);
    if site.is_empty() {
        return Err("Enter a Jira Site URL first.".to_string());
    }
    if email.trim().is_empty() {
        return Err("Enter your Jira account Email first.".to_string());
    }
    let project_key = if project_key.trim().is_empty() { "QDM" } else { project_key.trim() };
    let jql = QDM_JQL_TEMPLATE.replace("{project_key}", project_key);

    let client = Client::new();
    // /search/jql is Jira Cloud's current issue-search endpoint (the older
    // /search was deprecated) -- cursor-paginated via nextPageToken, no
    // isLast/total field to check instead.
    let url = format!("{site}/rest/api/3/search/jql");
    let mut results = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut body = serde_json::json!({
            "jql": jql,
            "maxResults": MAX_RESULTS_PER_PAGE,
            "fields": ["summary", "parent", "status"],
        });
        if let Some(t) = &page_token {
            body["nextPageToken"] = serde_json::Value::String(t.clone());
        }

        let resp = client
            .post(&url)
            .basic_auth(email, Some(token))
            .header("Accept", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Couldn't reach {site_url} -- {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err("Jira rejected these credentials -- check your Email and API Token.".to_string());
            }
            let detail = resp.text().await.unwrap_or_default();
            return Err(format!(
                "HTTP {status} from Jira while searching QDMs. {}",
                truncate(detail.trim(), 200)
            ));
        }

        let data: SearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Unexpected response from Jira -- {e}"))?;

        for issue in data.issues {
            results.push(QdmResult {
                jira_key: issue.key,
                summary: issue.fields.summary.unwrap_or_default(),
                parent_summary: issue.fields.parent.and_then(|p| p.fields.summary),
                status: issue.fields.status.name,
            });
        }

        if results.len() >= MAX_TOTAL_RESULTS {
            break;
        }
        match data.next_page_token {
            Some(t) => page_token = Some(t),
            None => break,
        }
    }

    Ok(results)
}

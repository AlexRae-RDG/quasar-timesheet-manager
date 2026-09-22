//! Uploads TimeEntries to Jira as worklogs (POST .../issue/{key}/worklog).
//! Only entries with a jiraKey can be uploaded -- the frontend filters to
//! those and does the started/timeSpentSeconds calculation itself (it
//! already has the date/time helpers this needs, and can read the
//! browser's own timezone offset for an accurate `started` value without
//! this crate taking on a new date/time dependency just for that). This
//! module is a thin, pure network layer plus the one DB write that marks
//! success so the same entry isn't silently re-uploaded next time.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::jira::{normalize_site_url, truncate};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorklogUploadItem {
    pub entry_id: i64,
    pub jira_key: String,
    /// Pre-formatted by the frontend, e.g. "2026-09-18T09:00:00.000+0100".
    pub started: String,
    pub time_spent_seconds: i64,
    pub comment: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorklogUploadOutcome {
    pub entry_id: i64,
    /// None = uploaded successfully.
    pub error: Option<String>,
}

/// Jira Cloud's v3 API expects worklog comments as Atlassian Document
/// Format, not a plain string -- this wraps one paragraph of plain text
/// into the minimal ADF shape it needs. None (field omitted entirely)
/// for blank notes, since a worklog comment is optional.
fn comment_adf(text: &str) -> Option<serde_json::Value> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "type": "doc",
        "version": 1,
        "content": [{
            "type": "paragraph",
            "content": [{ "type": "text", "text": trimmed }]
        }]
    }))
}

pub async fn post_worklog(site_url: &str, email: &str, token: &str, item: &WorklogUploadItem) -> Result<(), String> {
    let site = normalize_site_url(site_url);
    if site.is_empty() {
        return Err("Enter a Jira Site URL first.".to_string());
    }

    let client = Client::new();
    let url = format!("{site}/rest/api/3/issue/{}/worklog", item.jira_key);
    let mut body = serde_json::json!({
        "started": item.started,
        "timeSpentSeconds": item.time_spent_seconds,
    });
    if let Some(comment) = comment_adf(&item.comment) {
        body["comment"] = comment;
    }

    let resp = client
        .post(&url)
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Jira -- {e}"))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("Jira rejected these credentials -- check your Email and API Token.".to_string());
    }
    let detail = resp.text().await.unwrap_or_default();
    Err(format!(
        "HTTP {status} from Jira while logging work on {} -- {}",
        item.jira_key,
        truncate(detail.trim(), 200)
    ))
}

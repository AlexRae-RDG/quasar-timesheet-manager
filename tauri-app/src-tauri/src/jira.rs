//! Jira Cloud REST calls needed by the Settings screen. Mirrors the Python
//! app's `jira_client.py` `normalize_site_url`/`verify_credentials` exactly
//! (same endpoint, same 401/403-vs-other error split, same truncated error
//! detail).

use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct MyselfResponse {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

pub fn normalize_site_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

pub(crate) fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() > max_chars {
        let truncated: String = text.chars().take(max_chars).collect();
        format!("{truncated}\u{2026}")
    } else {
        text.to_string()
    }
}

pub async fn verify_credentials(site_url: &str, email: &str, token: &str) -> Result<String, String> {
    let site = normalize_site_url(site_url);
    if site.is_empty() {
        return Err("Enter a Jira Site URL first.".to_string());
    }
    if email.trim().is_empty() {
        return Err("Enter your Jira account Email first.".to_string());
    }
    if token.trim().is_empty() {
        return Err("Enter an API Token first.".to_string());
    }

    let client = Client::new();
    let url = format!("{site}/rest/api/3/myself");
    let resp = client
        .get(&url)
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach {site_url} -- {e}"))?;

    let status = resp.status();
    if status.is_success() {
        let data: MyselfResponse = resp
            .json()
            .await
            .map_err(|e| format!("Unexpected response from Jira -- {e}"))?;
        return Ok(data.display_name.unwrap_or_else(|| email.to_string()));
    }

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("Jira rejected these credentials -- check your Email and API Token.".to_string());
    }

    let detail = resp.text().await.unwrap_or_default();
    let detail = truncate(detail.trim(), 200);
    Err(format!(
        "HTTP {status} from Jira -- check your Site URL. {detail}"
    ))
}

#[derive(Deserialize)]
struct TransitionsResponse {
    transitions: Vec<Transition>,
}

#[derive(Deserialize)]
struct Transition {
    id: String,
    name: String,
    to: TransitionTo,
}

#[derive(Deserialize)]
struct TransitionTo {
    name: String,
}

/// Moves an issue to `target_status` via Jira's own transition graph --
/// Jira has no "set status directly" endpoint, only "list the transitions
/// available from here" (GET) then "fire one of them by id" (POST), so
/// this always does both. Matches by the transition's *resulting* status
/// name first (what the caller actually asked for), falling back to
/// matching the transition's own button label in case a workflow names
/// them differently (e.g. a "Reopen" button that lands on "In Progress").
pub async fn transition_issue(
    site_url: &str,
    email: &str,
    token: &str,
    issue_key: &str,
    target_status: &str,
) -> Result<(), String> {
    let site = normalize_site_url(site_url);
    if site.is_empty() {
        return Err("Enter a Jira Site URL first.".to_string());
    }

    let client = Client::new();
    let transitions_url = format!("{site}/rest/api/3/issue/{issue_key}/transitions");

    let resp = client
        .get(&transitions_url)
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Jira -- {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err("Jira rejected these credentials -- check your Email and API Token.".to_string());
        }
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {status} from Jira while looking up transitions for {issue_key}. {}",
            truncate(detail.trim(), 200)
        ));
    }

    let data: TransitionsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected response from Jira -- {e}"))?;

    let matched = data
        .transitions
        .iter()
        .find(|t| t.to.name.eq_ignore_ascii_case(target_status))
        .or_else(|| data.transitions.iter().find(|t| t.name.eq_ignore_ascii_case(target_status)));

    let Some(transition) = matched else {
        return Err(format!(
            "No transition to \"{target_status}\" is available for {issue_key} right now -- it may already be there, or your Jira workflow doesn't allow it directly."
        ));
    };

    let body = serde_json::json!({ "transition": { "id": transition.id } });
    let resp = client
        .post(&transitions_url)
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Jira -- {e}"))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let detail = resp.text().await.unwrap_or_default();
    Err(format!(
        "HTTP {status} from Jira while transitioning {issue_key}. {}",
        truncate(detail.trim(), 200)
    ))
}

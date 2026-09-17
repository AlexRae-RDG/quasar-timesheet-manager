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

fn truncate(text: &str, max_chars: usize) -> String {
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

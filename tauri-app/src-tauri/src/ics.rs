//! Fetches the raw contents of an Outlook/Google "shared calendar" .ics
//! link for the Timesheet's "Import from Outlook" feature. Parsing and
//! occurrence/RRULE expansion happen entirely on the frontend (see
//! src/lib/ics.ts) -- this only does the network fetch, so an arbitrary
//! external calendar host isn't subject to the webview's own CORS
//! restrictions the way a browser-side `fetch()` would be.

use reqwest::Client;
use std::time::Duration;

pub async fn fetch_ics(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Paste a calendar link first.".to_string());
    }
    // Outlook/Google publish "webcal://" links -- an alias browsers treat as
    // https for a subscribed calendar, but reqwest has no such scheme.
    let fetch_url = match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };

    let client = Client::new();
    let resp = client
        .get(&fetch_url)
        .header("Accept", "text/calendar, text/plain, */*")
        // Some tenants' edge/WAF silently drops requests with no
        // recognizable client (rather than a clean 403), which looks
        // identical to a plain network timeout -- a normal-looking browser
        // UA avoids that class of failure without changing anything else.
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Timed out waiting for that calendar link -- if it opens fine in a browser on this \
                 machine, this is likely your organization's network blocking the app's own request; \
                 if it also hangs in a browser, the link itself may need to be re-published in Outlook."
                    .to_string()
            } else {
                format!("Couldn't reach that calendar link -- {e}")
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status} while fetching that calendar link."));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Unexpected response while fetching that calendar link -- {e}"))?;

    if !text.contains("BEGIN:VCALENDAR") {
        return Err("That link didn't return a calendar (.ics) file.".to_string());
    }

    Ok(text)
}

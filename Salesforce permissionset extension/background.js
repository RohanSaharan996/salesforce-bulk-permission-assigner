chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background script received message:', request);

  // Helper function to normalize domain for cookie retrieval
  function getCookieDomains(tabUrl) {
    const urlObj = new URL(tabUrl);
    const hostname = urlObj.hostname;
    const domains = [];

    // Prioritize the exact domain from the active tab
    domains.push(`https://${hostname}`);

    // Add org-specific parent domains for sandboxes or production
    const parts = hostname.split('.');
    if (hostname.includes('.my.salesforce.com') || hostname.includes('.cs')) {
      if (parts.length > 3) {
        domains.push(`https://${parts.slice(-3).join('.')}`); // e.g., csXX.my.salesforce.com
        if (parts.length > 4) {
          domains.push(`https://${parts.slice(-4).join('.')}`); // e.g., <sandbox-name>.csXX.my.salesforce.com
        }
      }
    } else if (hostname.includes('.force.com')) {
      // Map Lightning to My Domain for API calls
      const myDomain = hostname.replace('.lightning.force.com', '.my.salesforce.com');
      domains.push(`https://${myDomain}`);
      domains.push('https://lightning.force.com');
    }

    // Add fallback login domain
    domains.push('https://login.salesforce.com');

    return [...new Set(domains)];
  }

  // Helper function to get a valid session ID
  async function getValidSessionId(tabUrl) {
    const urlObj = new URL(tabUrl);
    const hostname = urlObj.hostname;
    const domains = getCookieDomains(tabUrl);
    console.log('Attempting to retrieve session ID for domains:', domains, 'Active tab:', tabUrl);

    if (domains.length === 0) {
      console.error('Invalid Salesforce domain from URL:', tabUrl);
      throw new Error('Invalid Salesforce domain');
    }

    // Log all cookies for debugging
    for (const domain of domains) {
      try {
        const cookies = await new Promise((resolve) => {
          chrome.cookies.getAll({ url: domain }, (cookies) => {
            console.log(`All cookies for ${domain}:`, cookies.map(c => ({ name: c.name, domain: c.domain, value: c.value ? `${c.value.substring(0, 10)}...` : 'null', httpOnly: c.httpOnly })));
            resolve(cookies);
          });
        });
      } catch (err) {
        console.error(`Error fetching cookies for ${domain}:`, err);
      }
    }

    // Try cookie-based approach, prioritizing active tab's domain
    for (const domain of domains) {
      console.log(`Checking session cookie for ${domain}`);
      try {
        const cookie = await new Promise((resolve) => {
          chrome.cookies.get({ url: domain, name: 'sid' }, (cookie) => {
            console.log(`sid cookie for ${domain}:`, cookie ? `Found (domain: ${cookie.domain}, value: ${cookie.value.substring(0, 10)}..., httpOnly: ${cookie.httpOnly})` : 'Not found');
            resolve(cookie);
          });
        });

        if (cookie && cookie.value) {
          if (cookie.httpOnly) {
            console.warn(`sid cookie for ${domain} is HttpOnly and cannot be accessed`);
            continue;
          }
          console.log(`Validating session ID for ${domain}`);
          // Use My Domain for API calls (convert Lightning to My Domain)
          const apiDomain = (hostname.includes('my.salesforce.com') || hostname.includes('.cs'))
            ? `https://${hostname}`
            : hostname.includes('.lightning.force.com')
              ? `https://${hostname.replace('.lightning.force.com', '.my.salesforce.com')}`
              : domains.find(d => d.includes('my.salesforce.com')) || domains[0];
          const testQuery = "SELECT Id FROM User LIMIT 1";
          const testUrl = `${apiDomain}/services/data/v58.0/query?q=${encodeURIComponent(testQuery)}`;
          console.log(`Validating with: ${testUrl}`);
          const res = await fetch(testUrl, {
            headers: {
              'Authorization': `Bearer ${cookie.value}`,
              'Accept': 'application/json'
            }
          });
          if (res.ok) {
            console.log(`Session ID validated successfully for ${domain}, using API domain: ${apiDomain}`);
            return { sessionId: cookie.value, domain: apiDomain };
          } else {
            console.warn(`Validation failed for ${domain}, Status: ${res.status}, Response: ${await res.text()}`);
          }
        } else {
          console.warn(`No session cookie found for ${domain}`);
        }
      } catch (error) {
        console.warn(`Error checking ${domain}:`, error);
      }
    }

    console.error('No valid session cookie found across all domains');
    throw new Error('No valid session cookie found. Please log in to Salesforce or check if HttpOnly is enabled.');
  }

  // Helper function to make API requests
  async function makeApiRequest(url, sessionId, method = 'GET', body = null) {
    const headers = {
      'Authorization': 'Bearer ' + sessionId,
      'Accept': 'application/json'
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`API error: ${res.status} - ${errorText}`);
      }
      return res.json();
    } catch (error) {
      console.error(`API request failed for ${url}, Error: ${error.message}`);
      throw new Error(error.message || 'Network error: No response from server');
    }
  }

  // Main logic
  chrome.tabs.query({ active: true, currentWindow: true }, async function(tabs) {
    const tab = tabs[0];
    if (!tab || !tab.url) {
      console.error('No active Salesforce tab found');
      sendResponse({ success: false, error: 'No active Salesforce tab found.' });
      return;
    }

    let sessionId, domain;
    try {
      const sessionInfo = await getValidSessionId(tab.url);
      sessionId = sessionInfo.sessionId;
      domain = sessionInfo.domain;
      console.log(`Using session ID for domain: ${domain}`);
    } catch (error) {
      console.error('Session ID retrieval failed:', error);
      sendResponse({ success: false, error: error.message });
      return;
    }

    if (request.type === 'fetchUsers') {
      const soql = "SELECT Id, Name, Profile.Name FROM User WHERE IsActive = TRUE ORDER BY Name LIMIT 200";
      const apiUrl = `${domain}/services/data/v58.0/query?q=${encodeURIComponent(soql)}`;
      console.log(`Fetching users from: ${apiUrl}`);
      try {
        const data = await makeApiRequest(apiUrl, sessionId);
        sendResponse({ success: true, users: data.records });
      } catch (error) {
        console.error(`Error fetching users: ${error.message}`);
        sendResponse({ success: false, error: `Error fetching users: ${error.message}` });
      }
    } else if (request.type === 'assignPermissionSet') {
      try {
        const soql = `SELECT Id FROM PermissionSet WHERE Name = '${request.permissionSetApiName}' LIMIT 1`;
        const queryUrl = `${domain}/services/data/v58.0/query?q=${encodeURIComponent(soql)}`;
        console.log(`Fetching permission set from: ${queryUrl}`);
        const data = await makeApiRequest(queryUrl, sessionId);

        if (!data.records || data.records.length === 0) {
          throw new Error('Permission set not found');
        }
        const permissionSetId = data.records[0].Id;

        const results = [];
        for (const userId of request.userIds) {
          const assignUrl = `${domain}/services/data/v58.0/sobjects/PermissionSetAssignment/`;
          const body = { AssigneeId: userId, PermissionSetId: permissionSetId };
          console.log(`Assigning permission set to user ${userId}`);
          try {
            await makeApiRequest(assignUrl, sessionId, 'POST', body);
            results.push({ userId, success: true });
          } catch (err) {
            results.push({ userId, success: false, error: err.message });
          }
        }

        const allSuccess = results.every(r => r.success);
        sendResponse(allSuccess ? { success: true } : { success: false, error: JSON.stringify(results) });
      } catch (error) {
        console.error(`Error assigning permission set: ${error.message}`);
        sendResponse({ success: false, error: error.message });
      }
    } else if (request.type === 'fetchPermissionSets') {
      const soql = "SELECT Id, Name, Label FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label";
      const queryUrl = `${domain}/services/data/v58.0/query?q=${encodeURIComponent(soql)}`;
      console.log(`Fetching permission sets from: ${queryUrl}`);
      try {
        const data = await makeApiRequest(queryUrl, sessionId);
        sendResponse({ success: true, permissionSets: data.records });
      } catch (error) {
        console.error(`Error fetching permission sets: ${error.message}`);
        sendResponse({ success: false, error: error.message });
      }
    }
  });

  return true; // Async response
});
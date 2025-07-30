document.addEventListener('DOMContentLoaded', () => {
  const nameSearch = document.getElementById('nameSearch');
  const profileSearch = document.getElementById('profileSearch');
  const userList = document.getElementById('userList');
  const selectAllCheckbox = document.getElementById('selectAll');
  const selectedCount = document.getElementById('selectedCount');
  const permissionSetSelect = document.getElementById('permissionSetSelect');
  const assignButton = document.getElementById('assignButton');
  const statusDiv = document.getElementById('status');

  let allUsers = [];
  let filteredUsers = [];
  let allProfiles = [];

  function setStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
  }

  function updateSelectedCount() {
    const selectedUsers = userList.querySelectorAll('input[type="checkbox"]:checked');
    const count = selectedUsers.length;
    selectedCount.textContent = `(${count} selected)`;
    
    // Enable/disable assign button
    const hasSelection = count > 0;
    const hasPermissionSet = permissionSetSelect.value;
    assignButton.disabled = !hasSelection || !hasPermissionSet;
  }

  function renderUserList(users) {
    userList.innerHTML = '';
    
    if (users.length === 0) {
      userList.innerHTML = '<div class="loading">No users found matching your search criteria.</div>';
      return;
    }

    users.forEach(user => {
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      
      const profileName = user.Profile?.Name || 'No Profile';
      
      userItem.innerHTML = `
        <input type="checkbox" value="${user.Id}" data-user-id="${user.Id}">
        <div class="user-info">
          <div class="user-name">${user.Name}</div>
          <div class="user-profile">${profileName}</div>
        </div>
      `;
      
      userList.appendChild(userItem);
    });

    // Add event listeners to checkboxes
    userList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', updateSelectedCount);
    });

    updateSelectedCount();
  }

  function filterUsers() {
    const nameFilter = nameSearch.value.toLowerCase();
    const profileFilter = profileSearch.value;

    filteredUsers = allUsers.filter(user => {
      const nameMatch = user.Name.toLowerCase().includes(nameFilter);
      const profileMatch = !profileFilter || user.Profile?.Name === profileFilter;
      return nameMatch && profileMatch;
    });

    renderUserList(filteredUsers);
  }

  function populateProfileFilter() {
    // Get unique profiles
    const profiles = [...new Set(allUsers.map(user => user.Profile?.Name).filter(Boolean))];
    profiles.sort();
    
    profileSearch.innerHTML = '<option value="">All Profiles</option>';
    profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile;
      option.textContent = profile;
      profileSearch.appendChild(option);
    });
  }

  // Event Listeners
  nameSearch.addEventListener('input', filterUsers);
  profileSearch.addEventListener('change', filterUsers);

  selectAllCheckbox.addEventListener('change', (e) => {
    const checkboxes = userList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = e.target.checked;
    });
    updateSelectedCount();
  });

  // Add event listener for permission set selection
  permissionSetSelect.addEventListener('change', updateSelectedCount);

  assignButton.addEventListener('click', () => {
    const selectedCheckboxes = userList.querySelectorAll('input[type="checkbox"]:checked');
    const selectedUserIds = Array.from(selectedCheckboxes).map(cb => cb.value);
    const permissionSetApiName = permissionSetSelect.value;

    if (!selectedUserIds.length || !permissionSetApiName) {
      setStatus('Please select at least one user and a permission set.', 'error');
      return;
    }

    setStatus('Assigning permission set...', 'info');
    assignButton.disabled = true;

    chrome.runtime.sendMessage(
      {
        type: 'assignPermissionSet',
        userIds: selectedUserIds,
        permissionSetApiName: permissionSetApiName,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setStatus('Error: Could not connect to background script. Please refresh the page.', 'error');
          assignButton.disabled = false;
          return;
        }
        
        if (response && response.success) {
          setStatus(`Permission set assigned successfully to ${selectedUserIds.length} user(s)!`, 'success');
          // Uncheck all after successful assignment
          selectAllCheckbox.checked = false;
          userList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
          updateSelectedCount();
        } else {
          setStatus(`Error: ${response?.error || 'Unknown error'}`, 'error');
        }
        assignButton.disabled = false;
      }
    );
  });

  // Initialize the extension
  function initializeExtension() {
    setStatus('Loading...', 'info');

    // Check if we're on a Salesforce tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      
      if (!tab || !tab.url) {
        setStatus('No active tab found.', 'error');
        return;
      }

      const isSalesforce = tab.url.includes('salesforce.com') || tab.url.includes('force.com');
      if (!isSalesforce) {
        setStatus('Please open a Salesforce page to use this extension.', 'error');
        return;
      }

      // Fetch users
      chrome.runtime.sendMessage({ type: 'fetchUsers' }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus('Error: Could not connect to background script. Please refresh the page.', 'error');
          return;
        }
        
        if (!response || !response.success) {
          setStatus(response?.error || 'Error fetching users', 'error');
          return;
        }
        
        allUsers = response.users;
        filteredUsers = [...allUsers];
        
        populateProfileFilter();
        renderUserList(filteredUsers);
        setStatus(`Loaded ${allUsers.length} users`, 'success');
      });

      // Fetch permission sets
      chrome.runtime.sendMessage({ type: 'fetchPermissionSets' }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus('Error: Could not connect to background script. Please refresh the page.', 'error');
          return;
        }
        
        if (!response || !response.success) {
          setStatus(response?.error || 'Error fetching permission sets', 'error');
          return;
        }
        
        permissionSetSelect.innerHTML = '<option value="">Select Permission Set</option>';
        response.permissionSets.forEach((ps) => {
          const option = document.createElement('option');
          option.value = ps.Name;
          option.textContent = ps.Label;
          permissionSetSelect.appendChild(option);
        });
      });
    });
  }

  // Start the extension
  initializeExtension();
});
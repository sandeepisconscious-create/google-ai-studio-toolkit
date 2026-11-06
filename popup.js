// Popup Controller for Google AI Studio Toolkit
document.addEventListener('DOMContentLoaded', async () => {
  const statusPill = document.getElementById('status-pill');
  const stateActive = document.getElementById('state-active');
  const stateInactive = document.getElementById('state-inactive');
  const openStudioBtn = document.getElementById('open-studio-btn');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isStudio = tab && tab.url && tab.url.includes('aistudio.google.com');

    if (isStudio) {
      statusPill.textContent = 'Active';
      statusPill.classList.add('active');
      stateActive.style.display = 'block';
      stateInactive.style.display = 'none';
    } else {
      statusPill.textContent = 'Inactive';
      statusPill.classList.remove('active');
      stateActive.style.display = 'none';
      stateInactive.style.display = 'block';
    }
  } catch (e) {
    statusPill.textContent = 'Standby';
    stateInactive.style.display = 'block';
  }

  if (openStudioBtn) {
    openStudioBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://aistudio.google.com' });
      window.close();
    });
  }
});

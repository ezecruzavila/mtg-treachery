// Fills the page footer with the app version fetched from the server.
// Any page with an element id="app-version" gets its version shown.
fetch('/api/version')
  .then((r) => r.json())
  .then((d) => {
    const el = document.getElementById('app-version');
    if (el && d.version) el.textContent = 'v' + d.version;
  })
  .catch(() => {
    /* offline / host asleep — leave the footer blank */
  });

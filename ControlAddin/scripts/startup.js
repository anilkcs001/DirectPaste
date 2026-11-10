/*!
 * AK Direct Paste - startup.js (StartupScript)
 * Runs after helper.js and main.js are loaded and BC has wired the add-in.
 * Raises ControlAddInReady so AL calls Init(). If Init() has not arrived after 3 seconds
 * (event lost while the page was still loading), it asks once more.
 */
(function () {
  'use strict';

  function raiseReady() {
    try {
      Microsoft.Dynamics.NAV.InvokeExtensibilityMethod('ControlAddInReady', []);
    } catch (e) {
      console.error('[DirectPaste] Could not raise ControlAddInReady', e);
    }
  }

  raiseReady();
  window.setTimeout(function () {
    if (!window.AKDirectPasteInitReceived) {
      console.warn('[DirectPaste] Init() not received yet, raising ControlAddInReady again.');
      raiseReady();
    }
  }, 3000);
})();

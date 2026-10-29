const { createSettingsWindow, mockRouterFetch, closeAllCalendarWindows } = require('../helpers/browserDom');

afterEach(() => {
  closeAllCalendarWindows();
});

const CONFIG_ROUTE = { method: 'GET', url: '/api/config', body: {} };
const SCHEDULE_ROUTE = { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } };

// Waits for any fire-and-forget async chains (e.g. triggerScopedSync, kicked
// off without being awaited so Save can return immediately) to finish all
// their pending microtasks before assertions run.
function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// PR #37 review M5: concurrent toasts (now routine - a save can fire a
// "Property updated", a "Syncing…", and a result toast in quick
// succession) previously all rendered at the same fixed position with no
// stacking container, so they visually overlapped. All toasts must now
// share one stacking container instead of being independent fixed-
// position children of <body>.
describe('app.js - toast stacking (PR #37 review M5)', () => {
  test('showToast_calledMultipleTimes_appendsAllToastsIntoASharedStackingContainer', () => {
    const window = createSettingsWindow(mockRouterFetch([CONFIG_ROUTE]));

    window.showToast('First');
    window.showToast('Second', 'error');

    const toasts = window.document.querySelectorAll('.toast');
    expect(toasts.length).toBe(2);
    expect(toasts[0].parentElement).toBe(toasts[1].parentElement);
    expect(toasts[0].parentElement).not.toBe(window.document.body);
  });

  test('showToast_calledTwice_reusesTheSameStackingContainerRatherThanCreatingANewOneEachTime', () => {
    const window = createSettingsWindow(mockRouterFetch([CONFIG_ROUTE]));

    window.showToast('First');
    window.showToast('Second');

    expect(window.document.querySelectorAll('.toast-stack').length).toBe(1);
  });
});

describe('properties.js - per-bin-type opt-in switches (#35 Task 7)', () => {
  test('buildAddPropertyAccordion_withNoFlaggedBinTypes_rendersNoOptInSwitches', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    const accordion = window.document.getElementById('acc-add-prop');
    expect(accordion.querySelector('.opt-in-switches')).toBeNull();
    expect(accordion.textContent).not.toMatch(/Opt-in collections/);
  });

  test('buildAddPropertyAccordion_withOneFlaggedBinType_rendersOneUncheckedSwitchLabelledWithItsOwnColourAndLabel', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    const checkbox = window.document.getElementById('add-opt-in-1');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    const accordion = window.document.getElementById('acc-add-prop');
    expect(accordion.textContent).toContain('Garden Waste');
    expect(accordion.innerHTML).toMatch(/background:#92400e/);
    expect(accordion.innerHTML).not.toMatch(/PAID ADD-ON/);
  });

  // PR #37 review finding m8: a bare <label>Opt-in collections</label>
  // isn't programmatically associated with the group of checkboxes below
  // it - a <fieldset>/<legend> gives assistive tech a real accessible
  // name for the group, not just for each individual switch.
  test('buildOptInSwitches_groupsSwitchesInAFieldsetWithAnAccessibleLegend', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    const fieldset = window.document.querySelector('#acc-add-prop fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset.querySelector('legend').textContent).toMatch(/Opt-in collections/i);
    expect(fieldset.querySelector('#add-opt-in-1')).not.toBeNull();
  });

  test('buildAddPropertyAccordion_withTwoFlaggedBinTypes_rendersTwoSwitches', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
        { id: 2, summary_match: 'Bulky', label: 'Bulky Waste', colour: '#334455', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    expect(window.document.getElementById('add-opt-in-1')).not.toBeNull();
    expect(window.document.getElementById('add-opt-in-2')).not.toBeNull();
  });

  test('buildPropertyAccordion_withNoFlaggedBinTypes_rendersNoOptInSwitches', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [],
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    const accordion = window.document.getElementById('acc-prop-1');
    expect(accordion.querySelector('.opt-in-switches')).toBeNull();
  });

  test('buildPropertyAccordion_withTwoFlaggedBinTypes_eachSwitchReflectsOptedInBinTypeIdsIndependently', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1],
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
        { id: 2, summary_match: 'Bulky', label: 'Bulky Waste', colour: '#334455', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    expect(window.document.getElementById('prop-opt-in-1-1').checked).toBe(true);
    expect(window.document.getElementById('prop-opt-in-1-2').checked).toBe(false);
  });

  // The known sequencing hazard from the Design: renderPropertyAccordions()
  // needs _binTypes already populated (to know which types are flagged), so
  // bin types must be fetched before properties, not raced via Promise.all.
  test('loadSettings_fetchesBinTypesBeforeFetchingProperties', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      SCHEDULE_ROUTE,
    ], calls));

    await window.loadSettings();

    const binTypesIndex = calls.findIndex(c => c.method === 'GET' && c.url === '/api/bin-types');
    const propertiesIndex = calls.findIndex(c => c.method === 'GET' && c.url === '/api/properties');
    expect(binTypesIndex).toBeGreaterThanOrEqual(0);
    expect(propertiesIndex).toBeGreaterThanOrEqual(0);
    expect(binTypesIndex).toBeLessThan(propertiesIndex);
  });
});

describe('properties.js - saving opt-in switches (#35 Task 7)', () => {
  function flaggedBinTypesRoute() {
    return { method: 'GET', url: '/api/bin-types', body: [
      { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
      { id: 2, summary_match: 'Bulky', label: 'Bulky Waste', colour: '#334455', requires_opt_in: 1 },
    ] };
  }

  test('savePropertyEdit_turningASwitchOnWithNoTurnOffs_savesImmediatelyWithoutAWarning', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, message: 'Skipped — no properties configured' } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = true;
    await window.savePropertyEdit(1);

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    const putCall = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(putCall).toBeDefined();
    expect(putCall.body.opted_in_bin_type_ids).toEqual([1]);
  });

  test('savePropertyEdit_withNoSwitchChanges_savesButTriggersNoScopedSync', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
      // Deliberately no POST /api/properties/1/sync route - if one were
      // fired, mockRouterFetch would reject, proving a real assertion
      // failure rather than a silent pass.
    ], calls));

    await window.loadSettings();
    await window.savePropertyEdit(1); // no switches touched
    await flush();

    expect(calls.find(c => c.method === 'PUT')).toBeDefined();
    expect(calls.find(c => c.url === '/api/properties/1/sync')).toBeUndefined();
  });

  test('savePropertyEdit_turningOffOneOfTwoSwitches_showsWarningNamingOnlyThatOneAndDoesNotSaveYet', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1, 2],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = false; // Garden Waste off, Bulky stays on
    await window.savePropertyEdit(1);

    const modal = window.document.querySelector('.modal-overlay');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toMatch(/Garden Waste/);
    expect(modal.textContent).not.toMatch(/Bulky Waste/);
    expect(modal.textContent).toMatch(/removed/i);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('savePropertyEdit_turningOffBothSwitches_showsWarningNamingBothBinTypes', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1, 2],
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ]));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = false;
    window.document.getElementById('prop-opt-in-1-2').checked = false;
    await window.savePropertyEdit(1);

    const modal = window.document.querySelector('.modal-overlay');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toMatch(/Garden Waste/);
    expect(modal.textContent).toMatch(/Bulky Waste/);
    expect(modal.textContent).toMatch(/2/);
  });

  test('optInOffWarning_cancel_reChecksOnlyTheSwitchesThatWereTurnedOffAndNeverSaves', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1, 2],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = false;
    window.document.getElementById('prop-opt-in-1-2').checked = false;
    await window.savePropertyEdit(1);
    window.document.getElementById('opt-in-warning-cancel').click();

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(window.document.getElementById('prop-opt-in-1-1').checked).toBe(true);
    expect(window.document.getElementById('prop-opt-in-1-2').checked).toBe(true);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('optInOffWarning_confirm_savesWithOnlyTheRemainingBinTypesStillOptedIn', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1, 2],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, runId: 1, overallStatus: 'success', results: [{ propertyId: 1 }] } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = false; // only Garden Waste turned off
    await window.savePropertyEdit(1);
    await window.document.getElementById('opt-in-warning-confirm').onclick();

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    const putCall = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(putCall).toBeDefined();
    expect(putCall.body.opted_in_bin_type_ids).toEqual([2]);
  });

  // PR #34 review finding m4's a11y guarantees, carried forward onto the
  // generalized modal.
  async function openOptInOffWarning() {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = false;
    await window.savePropertyEdit(1);
    return { window, calls };
  }

  test('optInOffWarning_hasDialogRoleAriaModalAndLabelledBySetToTheTitle', async () => {
    const { window } = await openOptInOffWarning();

    const modal = window.document.querySelector('.modal');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    const labelId = modal.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(window.document.getElementById(labelId).textContent).toMatch(/Garden Waste/);
  });

  test('optInOffWarning_onOpen_movesFocusToTheCancelButton', async () => {
    const { window } = await openOptInOffWarning();

    expect(window.document.activeElement.id).toBe('opt-in-warning-cancel');
  });

  // PR #37 review finding m8: Cancel must return focus to wherever it
  // was before the modal opened (the Save button, the realistic
  // trigger), not leave a keyboard user stranded on <body>.
  test('optInOffWarning_cancel_restoresFocusToThePreviouslyFocusedElement', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1],
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      flaggedBinTypesRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ]));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = false;
    const saveBtn = window.document.querySelector('button[onclick="savePropertyEdit(1)"]');
    saveBtn.focus();
    await window.savePropertyEdit(1);
    window.document.getElementById('opt-in-warning-cancel').click();

    expect(window.document.activeElement).toBe(saveBtn);
  });

  // PR #37 review finding m8: a focus trap - Tab/Shift+Tab must cycle
  // between the modal's own two buttons rather than escaping into the
  // page behind the overlay. With exactly two focusable elements, Tab
  // and Shift+Tab both just toggle between them.
  test('optInOffWarning_tabFromConfirm_movesFocusToCancel', async () => {
    const { window } = await openOptInOffWarning();
    const cancelBtn = window.document.getElementById('opt-in-warning-cancel');
    const confirmBtn = window.document.getElementById('opt-in-warning-confirm');
    confirmBtn.focus();

    confirmBtn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(window.document.activeElement).toBe(cancelBtn);
  });

  test('optInOffWarning_shiftTabFromCancel_movesFocusToConfirm', async () => {
    const { window } = await openOptInOffWarning();
    const cancelBtn = window.document.getElementById('opt-in-warning-cancel');
    const confirmBtn = window.document.getElementById('opt-in-warning-confirm');
    cancelBtn.focus();

    cancelBtn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));

    expect(window.document.activeElement).toBe(confirmBtn);
  });

  test('optInOffWarning_escapeKey_dismissesLikeCancel', async () => {
    const { window, calls } = await openOptInOffWarning();

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(window.document.getElementById('prop-opt-in-1-1').checked).toBe(true);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('optInOffWarning_clickingTheBackdrop_dismissesLikeCancel', async () => {
    const { window, calls } = await openOptInOffWarning();

    window.document.querySelector('.modal-overlay').click();

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(window.document.getElementById('prop-opt-in-1-1').checked).toBe(true);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('optInOffWarning_clickingInsideTheModalItself_doesNotDismiss', async () => {
    const { window } = await openOptInOffWarning();

    window.document.querySelector('.modal').click();

    expect(window.document.querySelector('.modal-overlay')).not.toBeNull();
  });

  test('optInOffWarning_afterConfirmCloses_escapeKeyNoLongerDoesAnything', async () => {
    const { window } = await openOptInOffWarning();
    await window.document.getElementById('opt-in-warning-confirm').onclick();

    expect(() => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
    expect(window.document.querySelector('.modal-overlay')).toBeNull();
  });
});

describe('properties.js - scoped sync toast sequence (#35 Task 7)', () => {
  function singleFlaggedBinTypeRoute() {
    return { method: 'GET', url: '/api/bin-types', body: [
      { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
    ] };
  }

  async function saveWithOptInToggledOn(syncRoute) {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      singleFlaggedBinTypeRoute(),
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
      syncRoute,
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = true;
    await window.savePropertyEdit(1);
    return { window, calls };
  }

  test('savingAChangedSwitch_showsASyncingToastImmediately', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, runId: 1, overallStatus: 'success', results: [{ propertyId: 1 }] } }
    );

    const toasts = [...window.document.querySelectorAll('.toast')].map(t => t.textContent);
    expect(toasts.some(t => /Syncing/i.test(t) && /Home/.test(t))).toBe(true);
  });

  test('scopedSyncSucceeding_showsASuccessToastNamingTheProperty', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, runId: 1, overallStatus: 'success', results: [{ propertyId: 1 }] } }
    );
    await flush();

    const successToast = [...window.document.querySelectorAll('.toast-success')].find(t => /Home/.test(t.textContent) && /synced/i.test(t.textContent));
    expect(successToast).toBeDefined();
  });

  test('scopedSyncFailing_showsAnErrorToastWithTheFailureReason', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, runId: 1, overallStatus: 'failed', results: [{ propertyId: 1, error: 'Invalid credentials' }] } }
    );
    await flush();

    const errorToast = [...window.document.querySelectorAll('.toast-error')].find(t => /Invalid credentials/.test(t.textContent));
    expect(errorToast).toBeDefined();
  });

  test('scopedSyncSkippedBecauseNotConnected_doesNotShowASuccessToast', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, message: 'Skipped — no properties configured', overallStatus: 'skipped' } }
    );
    await flush();

    expect([...window.document.querySelectorAll('.toast-success')].some(t => /synced/i.test(t.textContent))).toBe(false);
    const infoToast = [...window.document.querySelectorAll('.toast-info')].find(t => /Home/.test(t.textContent));
    expect(infoToast).toBeDefined();
  });

  // PR #37 review finding m2: detection must key off the structured
  // overallStatus field, not string-match the message prose - reworded
  // message text here proves the check isn't coupled to that copy.
  test('scopedSyncSkipped_detectionDoesNotDependOnTheMessageWording', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, message: 'Nothing to do here', overallStatus: 'skipped' } }
    );
    await flush();

    expect([...window.document.querySelectorAll('.toast-success')].some(t => /synced/i.test(t.textContent))).toBe(false);
    const infoToast = [...window.document.querySelectorAll('.toast-info')].find(t => /Home/.test(t.textContent));
    expect(infoToast).toBeDefined();
  });

  // PR #37 review finding m7: an unrecognised overallStatus must never
  // fall into the success branch by default - only an explicit 'success'
  // should ever show a success toast.
  test('scopedSyncWithAnUnrecognisedOverallStatus_doesNotShowASuccessToast', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, runId: 1, overallStatus: 'partial', results: [{ propertyId: 1 }] } }
    );
    await flush();

    expect([...window.document.querySelectorAll('.toast-success')].some(t => /synced/i.test(t.textContent))).toBe(false);
  });

  // PR #37 review finding m3: the save already succeeded before the
  // scoped sync was even requested - the toast must make clear that the
  // SETTING was saved and only the push to the external calendar is
  // deferred, not that the Save itself failed.
  test('scopedSyncRejectedBecauseAnotherSyncIsRunning_showsAnErrorToastClarifyingTheSettingWasSaved', async () => {
    const { window } = await saveWithOptInToggledOn(
      { method: 'POST', url: '/api/properties/1/sync', ok: false, status: 429, body: { message: 'Sync already in progress' } }
    );
    await flush();

    const errorToast = [...window.document.querySelectorAll('.toast-error')].find(t => /already in progress/i.test(t.textContent));
    expect(errorToast).toBeDefined();
    expect(errorToast.textContent).toMatch(/saved/i);
    expect(errorToast.textContent).toMatch(/next sync/i);
  });
});

describe('properties.js - add-property form posts opted_in_bin_type_ids (#35 Task 7)', () => {
  test('addSaveAndGetGoogleUrl_withAnOptInSwitchChecked_postsTheSelectedBinTypeIds', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
        { id: 2, summary_match: 'Bulky', label: 'Bulky Waste', colour: '#334455', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
      { method: 'POST', url: '/api/properties', body: { id: 5 } },
      { method: 'GET', url: '/api/google/auth-url/5', body: { authUrl: 'https://auth.example' } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('add-label').value = 'Home';
    window.document.getElementById('add-ics-url').value = 'https://example.com/cal.ics';
    window.document.getElementById('add-opt-in-2').checked = true;
    await window.addSaveAndGetGoogleUrl();

    const postCall = calls.find(c => c.method === 'POST' && c.url === '/api/properties');
    expect(postCall).toBeDefined();
    expect(postCall.body.opted_in_bin_type_ids).toEqual([2]);
    expect(postCall.body.garden_waste_opted_in).toBeUndefined();
  });

  test('addSaveAndGetGoogleUrl_withNoSwitchesChecked_postsAnEmptyArray', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
      { method: 'POST', url: '/api/properties', body: { id: 5 } },
      { method: 'GET', url: '/api/google/auth-url/5', body: { authUrl: 'https://auth.example' } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('add-label').value = 'Home';
    window.document.getElementById('add-ics-url').value = 'https://example.com/cal.ics';
    await window.addSaveAndGetGoogleUrl();

    const postCall = calls.find(c => c.method === 'POST' && c.url === '/api/properties');
    expect(postCall.body.opted_in_bin_type_ids).toEqual([]);
  });
});

describe('properties.js - resilience to a failed GET /api/bin-types (PR #37 review C1)', () => {
  test('savePropertyEdit_whenBinTypesFailedToLoad_preservesExistingOptInsInsteadOfWipingThem', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: true, credential_status: 'ok',
      opted_in_bin_type_ids: [3], // property IS opted in to bin type 3
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', ok: false, status: 500, body: { error: 'boom' } },
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
      // Deliberately no POST /api/properties/1/sync route - a stray call
      // here would prove the fix failed, since nothing changed.
    ], calls));

    await window.loadSettings();
    expect(window.document.querySelector('.opt-in-switches')).toBeNull();

    window.document.getElementById('prop-label-1').value = 'Home renamed';
    await window.savePropertyEdit(1);
    await flush();

    const put = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(put).toBeDefined();
    expect(put.body.opted_in_bin_type_ids).toBeUndefined(); // omitted, not wiped to []
    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(calls.some(c => c.url === '/api/properties/1/sync')).toBe(false);
    expect(window.document.getElementById('prop-save-error-1').textContent).toMatch(/opt-in/i);
  });

  test('savePropertyEdit_whenBinTypesFailedToLoad_stillSavesLabelAndIcsUrlChanges', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: true, credential_status: 'ok', opted_in_bin_type_ids: [],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', ok: false, status: 500, body: { error: 'boom' } },
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-label-1').value = 'Renamed Home';
    await window.savePropertyEdit(1);

    const put = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(put.body.label).toBe('Renamed Home');
  });

  test('savePropertyEdit_whenBinTypesLoadedNormally_isUnaffectedByTheGuard', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [],
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
      { method: 'POST', url: '/api/properties/1/sync', body: { status: 200, runId: 1, overallStatus: 'success', results: [{ propertyId: 1 }] } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-opt-in-1-1').checked = true;
    await window.savePropertyEdit(1);
    await flush();

    const put = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(put.body.opted_in_bin_type_ids).toEqual([1]);
    expect(calls.some(c => c.url === '/api/properties/1/sync')).toBe(true);
  });
});

describe('properties.js - property switches stay in sync with bin-type edits (PR #37 review M6)', () => {
  test('saveBinTypeEdit_flaggingANewlyOptInRequiredType_rerendersPropertySwitchesWithoutReload', async () => {
    let binTypesState = [{ id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 0 }];
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [],
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: () => binTypesState },
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/bin-types/1', body: () => {
        binTypesState = [{ ...binTypesState[0], requires_opt_in: 1 }];
        return { ok: true };
      } },
    ]));

    await window.loadSettings();
    expect(window.document.getElementById('prop-opt-in-1-1')).toBeNull();

    window.editBinTypeRow(1);
    window.document.getElementById('bt-opt-in-1').checked = true;
    await window.saveBinTypeEdit(1);

    expect(window.document.getElementById('prop-opt-in-1-1')).not.toBeNull();
  });

  test('doDeleteBinType_removingAFlaggedType_removesItsSwitchFromThePropertyAccordion', async () => {
    let binTypesState = [{ id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 }];
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', opted_in_bin_type_ids: [1],
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: () => binTypesState },
      SCHEDULE_ROUTE,
      { method: 'DELETE', url: '/api/bin-types/1', body: () => { binTypesState = []; return {}; } },
    ]));

    await window.loadSettings();
    expect(window.document.getElementById('prop-opt-in-1-1')).not.toBeNull();

    await window.doDeleteBinType(1);

    expect(window.document.getElementById('prop-opt-in-1-1')).toBeNull();
  });
});

describe('properties.js - Bin Types requires_opt_in flag, generalized (#35 Task 7)', () => {
  test('buildBinTypeRow_withRequiresOptInTrue_showsACheckmarkInTheOptInColumn', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
        { id: 2, summary_match: 'Grey', label: 'General Waste', colour: '#6b7280', requires_opt_in: 0 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    const flaggedRow = window.document.getElementById('bin-type-row-1');
    const otherRow = window.document.getElementById('bin-type-row-2');
    expect(flaggedRow.textContent).toContain('✓');
    expect(otherRow.textContent).not.toContain('✓');
  });

  test('renderBinTypes_tableHeaderAndHintText_areGenericNotGardenWasteSpecific', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    const section = window.document.getElementById('bin-types-section');
    expect(section.textContent).toMatch(/opt-in/i);
    expect(section.textContent).not.toMatch(/Garden Waste collection in the table/i);
    expect(section.querySelector('th:nth-child(4)').textContent).not.toMatch(/Garden Waste/);
  });

  test('renderBinTypes_whenNoRowIsFlaggedOptIn_showsInertWarning', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Grey', label: 'General Waste', colour: '#6b7280', requires_opt_in: 0 },
        { id: 2, summary_match: 'Blue', label: 'Recycling', colour: '#3b82f6', requires_opt_in: 0 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    expect(window.document.getElementById('bin-types-section').textContent).toMatch(/have no effect/i);
  });

  test('renderBinTypes_whenAtLeastOneRowIsFlagged_hidesTheInertWarning', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 1 },
        { id: 2, summary_match: 'Grey', label: 'General Waste', colour: '#6b7280', requires_opt_in: 0 },
      ] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    expect(window.document.getElementById('bin-types-section').textContent).not.toMatch(/have no effect/i);
  });

  test('renderBinTypes_withNoBinTypesAtAll_doesNotShowTheInertWarning', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();

    expect(window.document.getElementById('bin-types-section').textContent).not.toMatch(/have no effect/i);
  });

  test('renderBinTypes_afterFlaggingARowViaEdit_theInertWarningDisappears', async () => {
    let binTypesState = [{ id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 0 }];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: () => binTypesState },
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/bin-types/1', body: () => {
        binTypesState = [{ ...binTypesState[0], requires_opt_in: 1 }];
        return { ok: true };
      } },
    ]));

    await window.loadSettings();
    expect(window.document.getElementById('bin-types-section').textContent).toMatch(/have no effect/i);

    window.editBinTypeRow(1);
    window.document.getElementById('bt-opt-in-1').checked = true;
    await window.saveBinTypeEdit(1);

    expect(window.document.getElementById('bin-types-section').textContent).not.toMatch(/have no effect/i);
  });

  test('saveBinTypeEdit_withOptInCheckboxChecked_persistsRequiresOptInTrue', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', requires_opt_in: 0 },
      ] },
      SCHEDULE_ROUTE,
      { method: 'PUT', url: '/api/bin-types/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.editBinTypeRow(1);
    window.document.getElementById('bt-opt-in-1').checked = true;
    await window.saveBinTypeEdit(1);

    const putCall = calls.find(c => c.method === 'PUT' && c.url === '/api/bin-types/1');
    expect(putCall).toBeDefined();
    expect(putCall.body.requires_opt_in).toBe(true);
    expect(putCall.body.is_garden_waste).toBeUndefined();
  });

  test('saveNewBinType_withOptInCheckboxChecked_persistsRequiresOptInTrue', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      SCHEDULE_ROUTE,
      { method: 'POST', url: '/api/bin-types', body: { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e' } },
    ], calls));

    await window.loadSettings();
    window.showAddBinTypeForm();
    window.document.getElementById('new-bt-match').value = 'Garden';
    window.document.getElementById('new-bt-label').value = 'Garden Waste';
    window.document.getElementById('new-bt-colour').value = '#92400e';
    window.document.getElementById('new-bt-opt-in').checked = true;
    await window.saveNewBinType();

    const postCall = calls.find(c => c.method === 'POST' && c.url === '/api/bin-types');
    expect(postCall).toBeDefined();
    expect(postCall.body.requires_opt_in).toBe(true);
  });

  test('showAddBinTypeForm_labelText_describesOptInGenericallyNotAsGardenWaste', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      SCHEDULE_ROUTE,
    ]));

    await window.loadSettings();
    window.showAddBinTypeForm();

    const label = window.document.getElementById('new-bt-opt-in').closest('label');
    expect(label.textContent).not.toMatch(/Garden Waste/);
    expect(label.textContent).toMatch(/opt-in/i);
  });
});

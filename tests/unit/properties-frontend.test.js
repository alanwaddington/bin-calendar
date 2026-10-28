const { createSettingsWindow, mockRouterFetch, closeAllCalendarWindows } = require('../helpers/browserDom');

afterEach(() => {
  closeAllCalendarWindows();
});

const CONFIG_ROUTE = { method: 'GET', url: '/api/config', body: {} };

describe('properties.js - Garden Waste opt-in (#33 Task 7)', () => {
  test('buildAddPropertyAccordion_rendersUncheckedGardenWasteControlLabelledAsPaidAddOn', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
    ]));

    await window.loadSettings();

    const checkbox = window.document.getElementById('add-garden-waste');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    const accordion = window.document.getElementById('acc-add-prop');
    expect(accordion.innerHTML).toMatch(/PAID ADD-ON/);
  });

  test('buildPropertyAccordion_optedInProperty_rendersCheckedGardenWasteControl', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'google',
      calendar_id: 'primary', connected: true, credential_status: 'ok', garden_waste_opted_in: 1,
    };
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'GET', url: '/api/google/calendars/1', body: [] },
    ]));

    await window.loadSettings();

    const checkbox = window.document.getElementById('prop-garden-waste-1');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
  });

  test('savePropertyEdit_withNoOptOutTransition_persistsGardenWasteOptedInImmediatelyWithoutAWarning', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', garden_waste_opted_in: 0,
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-garden-waste-1').checked = true; // turning ON needs no warning
    await window.savePropertyEdit(1);

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    const putCall = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(putCall).toBeDefined();
    expect(putCall.body.garden_waste_opted_in).toBe(true);
  });

  test('savePropertyEdit_turningGardenWasteOff_showsWarningModalAndDoesNotSaveYet', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', garden_waste_opted_in: 1,
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-garden-waste-1').checked = false;
    await window.savePropertyEdit(1);

    const modal = window.document.querySelector('.modal-overlay');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toMatch(/removed/i);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('gardenWasteOffWarning_cancel_reChecksTheBoxAndNeverSaves', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', garden_waste_opted_in: 1,
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-garden-waste-1').checked = false;
    await window.savePropertyEdit(1);
    window.document.getElementById('garden-waste-warning-cancel').click();

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(window.document.getElementById('prop-garden-waste-1').checked).toBe(true);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('gardenWasteOffWarning_confirm_savesWithGardenWasteOptedInFalse', async () => {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', garden_waste_opted_in: 1,
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-garden-waste-1').checked = false;
    await window.savePropertyEdit(1);
    await window.document.getElementById('garden-waste-warning-confirm').onclick();

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    const putCall = calls.find(c => c.method === 'PUT' && c.url === '/api/properties/1');
    expect(putCall).toBeDefined();
    expect(putCall.body.garden_waste_opted_in).toBe(false);
  });

  // PR #34 review finding m4: the modal had no ARIA role/labelling, no
  // keyboard or backdrop dismissal, and no focus management - it could
  // only be dismissed by mouse-clicking the Cancel button.
  async function openGardenWasteOffWarning() {
    const property = {
      id: 1, label: 'Home', ics_url: 'https://example.com/cal.ics', calendar_type: 'icloud',
      calendar_id: 'x', connected: false, credential_status: 'unknown', garden_waste_opted_in: 1,
    };
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [property] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'PUT', url: '/api/properties/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.document.getElementById('prop-garden-waste-1').checked = false;
    await window.savePropertyEdit(1);
    return { window, calls };
  }

  test('gardenWasteOffWarning_hasDialogRoleAriaModalAndLabelledBySetToTheTitle', async () => {
    const { window } = await openGardenWasteOffWarning();

    const modal = window.document.querySelector('.modal');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    const labelId = modal.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(window.document.getElementById(labelId).textContent).toMatch(/Turn off Garden Waste collection/);
  });

  test('gardenWasteOffWarning_onOpen_movesFocusToTheCancelButton', async () => {
    const { window } = await openGardenWasteOffWarning();

    expect(window.document.activeElement.id).toBe('garden-waste-warning-cancel');
  });

  test('gardenWasteOffWarning_escapeKey_dismissesLikeCancel', async () => {
    const { window, calls } = await openGardenWasteOffWarning();

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(window.document.getElementById('prop-garden-waste-1').checked).toBe(true);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('gardenWasteOffWarning_clickingTheBackdrop_dismissesLikeCancel', async () => {
    const { window, calls } = await openGardenWasteOffWarning();

    window.document.querySelector('.modal-overlay').click();

    expect(window.document.querySelector('.modal-overlay')).toBeNull();
    expect(window.document.getElementById('prop-garden-waste-1').checked).toBe(true);
    expect(calls.find(c => c.method === 'PUT')).toBeUndefined();
  });

  test('gardenWasteOffWarning_clickingInsideTheModalItself_doesNotDismiss', async () => {
    const { window } = await openGardenWasteOffWarning();

    window.document.querySelector('.modal').click();

    expect(window.document.querySelector('.modal-overlay')).not.toBeNull();
  });

  // The Escape listener is attached to `document` for the lifetime of the
  // modal - it must be removed on close, or it leaks and fires again (e.g.
  // re-checking a DIFFERENT, unrelated property's box) the next time any
  // code on the page presses Escape for an unrelated reason.
  test('gardenWasteOffWarning_afterConfirmCloses_escapeKeyNoLongerDoesAnything', async () => {
    const { window } = await openGardenWasteOffWarning();
    await window.document.getElementById('garden-waste-warning-confirm').onclick();

    expect(() => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    }).not.toThrow();
    expect(window.document.querySelector('.modal-overlay')).toBeNull();
  });
});

describe('properties.js - Bin Types is_garden_waste flag (#33 Task 7)', () => {
  test('buildBinTypeRow_withIsGardenWasteTrue_showsACheckmarkInTheGardenWasteColumn', async () => {
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', is_garden_waste: 1 },
        { id: 2, summary_match: 'Grey', label: 'General Waste', colour: '#6b7280', is_garden_waste: 0 },
      ] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
    ]));

    await window.loadSettings();

    const gardenRow = window.document.getElementById('bin-type-row-1');
    const otherRow = window.document.getElementById('bin-type-row-2');
    expect(gardenRow.textContent).toContain('✓');
    expect(otherRow.textContent).not.toContain('✓');
  });

  test('saveBinTypeEdit_withGardenWasteCheckboxChecked_persistsIsGardenWasteTrue', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [
        { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e', is_garden_waste: 0 },
      ] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'PUT', url: '/api/bin-types/1', body: { ok: true } },
    ], calls));

    await window.loadSettings();
    window.editBinTypeRow(1);
    window.document.getElementById('bt-garden-1').checked = true;
    await window.saveBinTypeEdit(1);

    const putCall = calls.find(c => c.method === 'PUT' && c.url === '/api/bin-types/1');
    expect(putCall).toBeDefined();
    expect(putCall.body.is_garden_waste).toBe(true);
  });

  test('saveNewBinType_withGardenWasteCheckboxChecked_persistsIsGardenWasteTrue', async () => {
    const calls = [];
    const window = createSettingsWindow(mockRouterFetch([
      CONFIG_ROUTE,
      { method: 'GET', url: '/api/properties', body: [] },
      { method: 'GET', url: '/api/bin-types', body: [] },
      { method: 'GET', url: '/api/settings/sync-schedule', body: { cronExpression: '0 0 1 * *', nextSync: null } },
      { method: 'POST', url: '/api/bin-types', body: { id: 1, summary_match: 'Garden', label: 'Garden Waste', colour: '#92400e' } },
    ], calls));

    await window.loadSettings();
    window.showAddBinTypeForm();
    window.document.getElementById('new-bt-match').value = 'Garden';
    window.document.getElementById('new-bt-label').value = 'Garden Waste';
    window.document.getElementById('new-bt-colour').value = '#92400e';
    window.document.getElementById('new-bt-garden').checked = true;
    await window.saveNewBinType();

    const postCall = calls.find(c => c.method === 'POST' && c.url === '/api/bin-types');
    expect(postCall).toBeDefined();
    expect(postCall.body.is_garden_waste).toBe(true);
  });
});

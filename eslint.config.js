const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  URL: 'readonly',
};

const jestGlobals = {
  describe: 'readonly',
  test: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  jest: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  FormData: 'readonly',
  localStorage: 'readonly',
  URLSearchParams: 'readonly',
  Intl: 'readonly',
};

// Classic multi-<script> SPA: public/*.js files share one global scope with
// no imports/exports, and functions are also called from inline onclick=""
// HTML attributes ESLint never sees. Rather than disable no-undef entirely
// (which would let a genuine typo in a function/variable name pass
// silently), every identifier declared anywhere across public/*.js is
// listed here - this lets no-undef still catch real typos (any name NOT in
// this list) while not flagging legitimate cross-file/inline-handler calls.
// Regenerate by grepping top-level `function`/`let`/`const` declarations
// across public/*.js if a new one is added.
const publicSharedGlobals = {
  CONFIG: 'writable',
  _binTypes: 'writable',
  _calEvents: 'writable',
  _calMonthsWithData: 'writable',
  _calProperties: 'writable',
  _calRequestToken: 'writable',
  _calViewMonth: 'writable',
  _calViewYear: 'writable',
  _settingsProperties: 'writable',
  addCompleteGoogleAuth: 'writable',
  addFetchIcloudCalendars: 'writable',
  addSaveAndGetGoogleUrl: 'writable',
  addSaveGoogleCalendar: 'writable',
  addSaveIcloud: 'writable',
  api: 'writable',
  buildAddPropertyAccordion: 'writable',
  buildBinTypeRow: 'writable',
  buildCronExpression: 'writable',
  buildMonthMatrix: 'writable',
  buildPropertyAccordion: 'writable',
  buildScheduleSentenceHTML: 'writable',
  calDateStr: 'writable',
  cancelAddBinType: 'writable',
  completeGoogleReconnect: 'writable',
  confirmDeleteBinType: 'writable',
  confirmDeleteProperty: 'writable',
  doDeleteBinType: 'writable',
  doDeleteProperty: 'writable',
  editBinTypeRow: 'writable',
  escAttr: 'writable',
  escCalHtml: 'writable',
  escHtml: 'writable',
  escLogHtml: 'writable',
  fetchIrcCalendars: 'writable',
  findNearestMonthWithData: 'writable',
  getCalendarMonthsWithData: 'writable',
  getStatusBadge: 'writable',
  groupCalendarEventsByDate: 'writable',
  loadCalendar: 'writable',
  loadDashboard: 'writable',
  loadGoogleCalendarsForProp: 'writable',
  loadLogs: 'writable',
  loadSettings: 'writable',
  localHourToUtc: 'writable',
  navigate: 'writable',
  navigateToProperty: 'writable',
  onCalendarPropertyChange: 'writable',
  onFrequencyChange: 'writable',
  pad2: 'writable',
  parseCronToSelection: 'writable',
  refreshDashboard: 'writable',
  registerView: 'writable',
  renderAddCalendarFields: 'writable',
  renderBinTypes: 'writable',
  renderCalendarAgenda: 'writable',
  renderCalendarGrid: 'writable',
  renderCalendarMarker: 'writable',
  renderCalendarMonth: 'writable',
  renderCalendarNoProperties: 'writable',
  renderCalendarShell: 'writable',
  renderHeroCard: 'writable',
  renderLogResult: 'writable',
  renderLogs: 'writable',
  renderPropertyAccordions: 'writable',
  renderPropertyTiles: 'writable',
  renderSparkline: 'writable',
  renderSyncSchedule: 'writable',
  saveBinTypeEdit: 'writable',
  saveGoogleReconnectCalendar: 'writable',
  saveIcloudReconnect: 'writable',
  saveNewBinType: 'writable',
  savePropertyEdit: 'writable',
  saveSyncSchedule: 'writable',
  scheduleDescription: 'writable',
  selectCalendarProperty: 'writable',
  showAddBinTypeForm: 'writable',
  showGoogleReconnect: 'writable',
  showIcloudReconnect: 'writable',
  showToast: 'writable',
  startGoogleReconnect: 'writable',
  stepCalendarMonth: 'writable',
  syncNow: 'writable',
  toggleAccordion: 'writable',
  toggleSyncScheduleAccordion: 'writable',
  utcHourToLocal: 'writable',
  viewLoaders: 'writable',
};

module.exports = [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    files: ['*.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, ...jestGlobals },
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, ...publicSharedGlobals },
    },
    rules: {
      // no-undef stays ON (with the explicit globals above) so a genuine
      // typo in a function/variable name is still caught. no-unused-vars
      // stays off: usage via inline onclick="" HTML attributes is real but
      // invisible to ESLint, so it can't reliably tell declared-but-unused
      // apart from declared-and-called-from-markup.
      'no-unused-vars': 'off',
      // builtinGlobals:false - a file legitimately declaring a name that's
      // also listed in publicSharedGlobals (so other files can call it) is
      // not a real redeclaration; still catches genuine duplicate
      // declarations within the same file.
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
];

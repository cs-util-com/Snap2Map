/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
    // Only cruise our source files
    includeOnly: '^src',
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]*',
      },
    },
    // Define module layers for architectural validation
    moduleSystems: ['es6'],
    tsPreCompilationDeps: true,
  },
  forbidden: [
    // 1. Critical: No circular dependencies
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
    // 2. Core logic modules should not depend on UI or other high-level modules
    {
      name: 'no-core-logic-to-ui-dependencies',
      severity: 'error',
      from: {
        path: '^(src/calib|src/data|src/gps|src/util)',
      },
      to: {
        path: '^(src/ui|src/leaflet|src/pwa)',
      },
    },
    // 3. Leaflet integration should not be depended upon by core data/logic
    {
      name: 'no-core-to-leaflet-dependencies',
      severity: 'error',
      from: {
        path: '^(src/calib|src/data|src/gps|src/util)',
      },
      to: {
        path: '^src/leaflet',
      },
    },
    // 4. The utility module should be foundational (no outgoing dependencies)
    {
      name: 'util-has-no-dependencies',
      severity: 'error',
      from: {
        path: '^src/util',
      },
      to: {
        // This regex matches any path within src except for src/util itself
        path: '^src/(?!util)',
      },
    },
  ],
};

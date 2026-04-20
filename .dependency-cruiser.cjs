/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'dto-only-dto-as-dependencies',
      comment:
        '@shipfox/*-dto packages may only have other *-dto packages as production dependencies. All other @shipfox packages must be devDependencies.',
      severity: 'error',
      from: {path: '^(src|test)/'},
      to: {
        // pnpm workspace deps resolve as relative paths (../sibling/).
        // Match any workspace sibling that is not a *-dto package.
        path: '^\\.\\./[^./][^/]*/(?:src|dist)/',
        pathNot: '^\\.\\./[^/]+-dto/',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'development'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};

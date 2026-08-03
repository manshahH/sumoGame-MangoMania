// node entry point for the self-tests: `npm test` runs this.
// The browser runs exactly the same suite via `?test` on the desktop.

import { runSelfTests } from './selftests.js'

const result = runSelfTests()
process.exit(result.ok ? 0 : 1)

# Managed legacy modules

`../legacy-modules.cjs` owns only the processes it starts. The original standalone programs, their running processes and their data are never discovered, reused or stopped by this supervisor.

- `ledger`: existing accounting v1.3.0 maintenance layer; `LEDGER_DATA` selects the full existing directory containing `ledger.db` and `secret.key`.
- `inventory`: supplied repaired inventory v1.9.0 bytecode; `STOCKCHECK_DATA` selects the full existing directory containing `stockcheck.db` and `secret.key`.
- Accounts, role checks, original CSRF, routes, reports, printing and binary downloads remain inside their original modules. Data is not synchronized with the sales database or between these modules.
- The managed binaries include Python and dependencies. End users do not need Python or an external browser.

The wrapper validates schema and an existing account before importing or calling the original application factory. Missing data is rejected, so startup cannot create an empty business database or a default administrator.

Each lazy startup chooses a loopback port and a random private token. Every route requires `X-XJY-Module-Token`. Health must match the module, maintained version, random token, and SHA256 of the normalized absolute data path, while the owned process remains alive. A different listener is never adopted. Cookies are named `xjy_ledger_session` and `xjy_inventory_session`; the Electron host also provides module-specific browser sessions.

`/_xjy/shutdown` is private and token-protected. It rejects new business requests, lets existing WSGI work and socket output finish, stops the accounting background synchronization and daily backup loops after their current work, then closes Waitress. The supervisor waits up to 25 seconds and falls back to terminating only that owned process tree. These private control routes cannot be reached through `proxy()`.

The public Node contract is `createLegacyModules({settingsFile,runtimeDir,packagedDir})` with synchronous `status()` and asynchronous `configure(id,dataDir)`, `proxy({module,path,method,headers,bodyBase64})`, and `close()`. The packaged directory contains `manifest.json` and the two real `.exe` files. Only manifest-verified bytes are extracted to the private runtime directory. Request bodies are limited to 48 MiB and responses to 64 MiB. Redirects stay relative to the selected module. Multiple `Set-Cookie` headers and download metadata are retained.

Rebuild from this work copy with Python 3.14 and the supplied PyInstaller/dependencies:

```text
python desktop/legacy-source/build-sidecars.py ledger
python desktop/legacy-source/build-sidecars.py inventory
python desktop/legacy-source/write-manifest.py
node --test desktop/tests/legacy-modules.test.cjs
```

`make-test-fixture.py` is test-only and can create data solely in the isolated test scratch directory. Historical maintenance regression/build directories are excluded from the copied source. Do not include `legacy-source`, `.legacy-build`, or test fixtures in the customer application package.

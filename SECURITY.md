# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this project, please report it responsibly:

1. **Do not open a public issue.** Instead, send an email to **security@elvatis.com** with:
   - A clear description of the vulnerability
   - Steps to reproduce
   - Expected and actual behavior
   - Any PoC code or attachments (zip) if safe to share

2. We will acknowledge receipt within **48 hours** and provide a timeline for fixes.

3. Do not publicly disclose the issue until we have had a reasonable time to address it.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.10.x | ✅ Yes    |
| < 0.7   | ❌ No     |

We appreciate responsible disclosure.

## Handling API Keys

This extension stores a provider key in the `conduit.apiKey` setting and
persists agent sessions to disk. Keep keys in VS Code Settings, not in a
workspace file that gets committed. `conduit.proxyUrl` should stay on
loopback: pointing it at a remote host sends prompts, and any key the
bridge holds, to that host.

Never paste a key into an issue or a log excerpt. Rotate at the provider if
one is exposed; this extension cannot revoke it.

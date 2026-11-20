# Security policy

## Reporting a vulnerability

Please report security problems privately to **security@kaitiaki-it.com**. Do not open a public issue.

Include what you found, the version (Settings › About), your operating system, and steps to reproduce. If you can,
encrypt with our key (published on the website once available).

We aim to acknowledge a report within 3 working days, give a first assessment within 10, and release a fix for
confirmed issues as quickly as their severity requires. We will credit you in the release notes unless you would
rather not be named. Please give us a reasonable time to fix the problem before you disclose it.

## Supported versions

The latest release receives security fixes. Ironleaf updates itself; organisations pinning a channel by managed
policy (docs/EDITIONS.md) should follow the release notes.

## Scope

In scope: the desktop app, its MCP server and local URL, the update mechanism (latest.json and its signature), the
web clipper extension in `extensions/clipper`, and the release tooling in `tools/`.

Out of scope: problems that need an attacker who already controls the user's account on the machine, and issues in
third-party AI apps you connect to Ironleaf.

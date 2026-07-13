# Capabilities and Preferences

Policy schema v2 does not use capabilities for authorization. Availability is
an enabled policy entry plus observed installation on the current agent.

Use optional `preference` when one matching skill should rank ahead of another:

```yaml
skills:
  test-first:
    enabled: true
    shared: false
    preference:
      intents: [implementation, testing]
      priority: 100
```

Preference ranks only and never changes availability. Explicit user selection
wins among guard-allowed candidates.

Version 1 capability catalogs and workflow requirements are migration input
only. Migration may convert names to intent terms and priorities, reports
discarded policy fields, and never carries capability policy into the v2 guard.

Manual skill variants are content-management records, not authorization.
Runtime and action permission checks stay with the agent or harness.

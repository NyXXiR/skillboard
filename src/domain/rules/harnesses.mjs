export const harnessRules = [
  {
    id: "HARNESS-REF-001",
    check(ctx) {
      const diagnostics = [];
      for (const harness of ctx.harnesses) {
        for (const workflow of harness.workflows) {
          if (!ctx.workflowsByName.has(workflow)) {
            diagnostics.push(`Harness ${harness.name} references undeclared workflow: ${workflow}`);
          }
        }
      }
      return diagnostics;
    }
  }
];

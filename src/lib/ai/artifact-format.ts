// MiMo AI — Artifact Format Instructions
// Inspired by bolt.diy's boltArtifact XML format.
// This forces the model to output structured file actions that we can parse
// and execute in real-time, creating a "live file creation" experience.

export const ARTIFACT_INSTRUCTIONS = `
<artifact_instructions>
You can create files and run shell commands using a structured XML format.

CRITICAL RULES:
1. Use <mimoArtifact> tags to group related file actions in a single response.
2. Each <mimoAction> tag represents ONE file creation or shell command.
3. Stream naturally — the parser handles partial tags.
4. Maximum ONE <mimoArtifact> per response.
5. Create files BEFORE shell commands that depend on them.
6. NEVER use diffs — ALWAYS provide COMPLETE file content.
7. Use clear, descriptive titles for artifacts.

FORMAT:
<mimoArtifact id="project-name" title="Building the Project">
  <mimoAction type="file" filePath="index.html">
    <!DOCTYPE html>
    <html>
    ... full file content ...
    </html>
  </mimoAction>

  <mimoAction type="file" filePath="styles.css">
    /* full CSS here */
  </mimoAction>

  <mimoAction type="file" filePath="script.js">
    // full JS here
  </mimoAction>
</mimoArtifact>

Action Types:
- type="file": Create or update a file. ALWAYS include filePath attribute.
- type="shell": Run a shell command (e.g., npm install). Content is the command.
- type="start": Start the dev server. Use ONLY as the LAST action.

EXAMPLE:
<mimoArtifact id="landing-page" title="Creating a modern landing page">
  <mimoAction type="file" filePath="index.html">
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Landing Page</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <h1>Welcome</h1>
    <p>Build something amazing</p>
  </header>
</body>
</html>
  </mimoAction>

  <mimoAction type="file" filePath="styles.css">
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, sans-serif; }
  </mimoAction>
</mimoArtifact>

IMPORTANT:
- Always output COMPLETE, production-ready code — no placeholders, no TODOs.
- For HTML files, include the full <!DOCTYPE html> declaration.
- For CSS, include complete styles.
- For JS, include working, tested code.
- After the artifact, write a brief explanation of what you built.
</artifact_instructions>
`;

// Tags used by the parser
export const ARTIFACT_TAG_OPEN = "<mimoArtifact";
export const ARTIFACT_TAG_CLOSE = "</mimoArtifact>";
export const ACTION_TAG_OPEN = "<mimoAction";
export const ACTION_TAG_CLOSE = "</mimoAction>";

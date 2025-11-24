# Example: Bi-directional Zotero Workflow

Complete walkthrough of the enhanced source skill with Zotero integration.

## Scenario 1: URL Already in Zotero

User: "I found this article: https://arxiv.org/abs/1108.1791"

### Step 1: Check Zotero
```bash
cd ~/vault
zotero-lookup.py --url "http://arxiv.org/abs/1108.1791"
```

**Output:**
```
Found 1 match(es):
1. Why Philosophers Should Care About Computational Complexity (2011) - Aaronson, Scott
   URL: http://arxiv.org/abs/1108.1791
```

### Step 2: Use zotlit-create.py
Since item exists in Zotero, use the full metadata workflow:

```bash
zotlit-create.py --author "Aaronson"
```

**Result:**
- Creates: `Literature/Aaronson - Why Philosophers Should Care About Computational C (2011).md`
- Logs to daily note under "## Reading"
- Includes: Full metadata, abstract, tags, attachments

---

## Scenario 2: URL Not in Zotero (Add It)

User: "I just read this blog post: https://blog.acolyer.org/2023/05/12/papers-we-love/"

### Step 1: Check Zotero
```bash
zotero-lookup.py --url "https://blog.acolyer.org/2023/05/12/papers-we-love/"
```

**Output:**
```
No matches found.
```

### Step 2: Ask User
"This URL isn't in your Zotero library. Would you like to add it?"

Options:
- Yes (academic paper) → `journalArticle`
- Yes (blog post) → `blogPost`
- No (just create note)

User selects: **"Yes (blog post)"**

### Step 3: Add to Zotero via API

Requires config in `~/.config/dere/config.toml`:
```toml
[zotero]
library_id = "12345"
library_type = "user"
api_key = "AbCdEf123456..."
```

Run:
```bash
zotero-add-item.py \
  --title "Papers We Love" \
  --url "https://blog.acolyer.org/2023/05/12/papers-we-love/" \
  --author "Adrian Colyer" \
  --date "2023-05-12" \
  --type blogPost
```

**Output:**
```
Successfully created item in Zotero
  Item key: XYZ123AB
  Title: Papers We Love
  URL: https://blog.acolyer.org/2023/05/12/papers-we-love/

View in Zotero: https://www.zotero.org/users/12345/items/XYZ123AB
```

### Step 4: Create Note from Zotero
Now that item exists in Zotero, use `zotlit-create.py`:

```bash
zotlit-create.py --title "Papers We Love"
```

**Result:**
- Item now in Zotero library with proper metadata
- Literature note created with Zotero metadata
- Logged to daily note

---

## Scenario 3: URL Not in Zotero (Skip It)

User: "Quick summary of: https://news.ycombinator.com/item?id=38471744"

### Step 1: Check Zotero
```bash
zotero-lookup.py --url "https://news.ycombinator.com/item?id=38471744"
```

**Output:**
```
No matches found.
```

### Step 2: Ask User
"This URL isn't in your Zotero library. Would you like to add it?"

User selects: **"No (just create note)"**

### Step 3: Manual Note Creation
Since user doesn't want it in Zotero, create manual literature note:

1. Fetch content via WebFetch
2. Extract metadata (title, date) from HTML
3. Summarize in own words
4. Create note with standard frontmatter
5. Log to daily note manually

**Created note:** `Literature/Hacker News - Discussion on LLMs.md`

```markdown
---
type: literature
status: complete
created: 2025-11-23
source: https://news.ycombinator.com/item?id=38471744
title: "Discussion on LLMs"
date_accessed: 2025-11-23
tags:
  - source/discussion
  - llm
---

# Discussion on LLMs

## Summary
Community discussion about large language models...

## Key Concepts
- ...
```

---

## Configuration Setup

### Required: Zotero API Key

1. Visit: https://www.zotero.org/settings/keys
2. Click "Create new private key"
3. Permissions:
   - ✓ Allow library access
   - ✓ Allow write access
   - ✗ Notes access (not needed)
4. Copy generated key

### Config File: `~/.config/dere/config.toml`

```toml
[zotero]
library_id = "12345"  # Your user ID (found in Zotero URL)
library_type = "user"  # or "group" for group libraries
api_key = "AbCdEf123456..."  # Generated key from step above
```

### Find Your Library ID

Visit: https://www.zotero.org/settings/keys

Your library ID is shown at the top: "Your userID for use in API calls is **12345**"

---

## Tools Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `zotero-lookup.py` | Check if URL/title exists | Before every source creation |
| `zotlit-create.py` | Create note from Zotero | When item exists in Zotero |
| `zotero-add-item.py` | Add item to Zotero | When user wants to track source |
| `bib-lookup.py` | Fallback BibTeX search | When Zotero DB unavailable |

---

## Workflow Decision Tree

```
User provides URL/title
↓
Check Zotero: zotero-lookup.py
↓
┌─────────────────────────────┐
│ Found in Zotero?            │
└─────────────────────────────┘
         │
    ┌────┴────┐
    YES       NO
    │         │
    │         Ask user: "Add to Zotero?"
    │         │
    │    ┌────┴────┐
    │    YES       NO
    │    │         │
    │    Add via API    Create manual note
    │    │         │
    │    Wait for sync  Extract metadata
    │    │         │
    └────┴─────────┘
         │
    zotlit-create.py
         │
    Log to daily note
         │
    Done
```

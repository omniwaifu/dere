---
name: citation-discipline-enforcer
description: Ensure all URLs come from trusted sources (WebSearch results, WebFetch visited pages, or user-provided). Prevents URL fabrication. Triggers when providing links or documentation references.
---

# Citation Discipline Enforcer

## URL Sourcing Policy

**ONLY use URLs from:**
1. WebSearch results
2. Pages visited with WebFetch
3. User-provided links
4. Context7 library documentation

**NEVER:**
- Fabricate or guess URLs
- Construct URLs from patterns
- Assume documentation locations

## Workflow for References

**If you need to reference documentation:**
```
1. WebSearch("library-name official documentation")
2. Extract URL from search results
3. WebFetch(url) to verify content
4. Cite the verified URL
```

**Alternative:**
```
1. Use Context7 for library docs (already verified)
2. Cite as "Context7: /library/name"
```

## Remember

- Real citations only
- When in doubt, search first
- Context7 for libraries
- User frustration from broken links > no link at all

# Bad API Documentation Example

Incomplete and vague API documentation.

````markdown
# ZoteroClient API

## ZoteroClient

Creates a powerful client for interacting with Zotero's comprehensive API.

Example:
```python
client = ZoteroClient(config)
````

## search_items

Intelligently searches your library using advanced algorithms.

Returns the items you're looking for!

Example:

```python
results = client.search_items("some query")
```

## add_item

Easily add items to your library. Simply provide the details and our robust
system handles the rest!

Parameters:

- title - the title
- other stuff - optional

Example:

```python
client.add_item(title, some_url, author, type)
```

## get_collections

Gets all your collections in a convenient format.

```python
collections = client.get_collections()
```

````

## Why This Fails

### Missing Type Information
- ❌ No parameter types
- ❌ No return types
- ❌ No indication of what's optional
- ❌ Can't use this for type checking

### Marketing Language
- ❌ "powerful", "comprehensive"
- ❌ "intelligently", "advanced algorithms"
- ❌ "robust system"
- ❌ Focuses on selling, not documenting

### Vague Parameters
- ❌ "the title" - what type?
- ❌ "other stuff" - what stuff?
- ❌ "optional" - which ones?
- ❌ No explanation of what values mean

### Incomplete Examples
- ❌ Uses placeholders ("some query", "some_url")
- ❌ Doesn't show actual usage
- ❌ No output shown
- ❌ No error handling

### No Exception Information
- ❌ Doesn't document what can fail
- ❌ No error types listed
- ❌ Can't write proper error handling

### Unhelpful Descriptions
- ❌ "Gets collections" - obvious from name
- ❌ "Returns items you're looking for" - not helpful
- ❌ "Handles the rest" - what does it handle?

## How to Fix

### Add Complete Signatures
```python
# Bad
search_items(query)

# Good
search_items(query: str, search_type: str = "title") -> list[ZoteroItem]
````

### Document All Parameters

```markdown
# Bad
Parameters:
- title - the title

# Good
**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| title | str | Item title |
| url | str \| None | Item URL (optional) |
| author | str \| None | Author in "Last, First" format (optional) |
| item_type | str | Type: "webpage", "blogPost", "journalArticle", "book" |
```

### Show Real Examples

```python
# Bad
client.search_items("some query")

# Good
items = client.search_items("Computational Complexity", search_type="title")
for item in items:
    print(f"{item.title} by {item.format_authors()}")
```

### Document Exceptions

```markdown
# Bad
[nothing]

# Good
**Raises:**
- ValueError: If title is empty
- APIError: If Zotero API request fails
```

### Remove Marketing

```markdown
# Bad
Intelligently searches your library using advanced algorithms.

# Good
Search library for items matching query.
```

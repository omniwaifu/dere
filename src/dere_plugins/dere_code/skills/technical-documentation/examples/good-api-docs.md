# Good API Documentation Example

Clear, concise API documentation with complete information.

```markdown
# ZoteroClient API

## ZoteroClient(config: ZoteroConfig)

Create Zotero API client.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| config | ZoteroConfig | Configuration with library_id, api_key, library_type |

**Raises:**
- ValueError: If library_id or api_key is missing

**Example:**
```python
from zotero import ZoteroClient, ZoteroConfig

config = ZoteroConfig(
    library_id="12345",
    api_key="abc123",
    library_type="user"
)
client = ZoteroClient(config)
```

## search_items(query: str, search_type: str = "title") -> list[ZoteroItem]

Search library for items matching query.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| query | str | Search term |
| search_type | str | Search field: "title", "author", "url", or "citekey" |

**Returns:**
list[ZoteroItem] - Matching items with metadata

**Example:**
```python
# Search by title
items = client.search_items("Computational Complexity", search_type="title")

# Search by author
items = client.search_items("Aaronson", search_type="author")

# Search by URL
items = client.search_items("arxiv.org/abs/1108.1791", search_type="url")
```

## add_item(title: str, url: str | None, author: str | None, item_type: str) -> str

Add new item to library.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| title | str | Item title |
| url | str \| None | Item URL (optional) |
| author | str \| None | Author in "Last, First" format (optional) |
| item_type | str | Type: "webpage", "blogPost", "journalArticle", "book" |

**Returns:**
str - Item key for created item

**Raises:**
- ValueError: If title is empty
- APIError: If Zotero API request fails

**Example:**
```python
# Add journal article
key = client.add_item(
    title="Quantum Computing Since Democritus",
    url="https://arxiv.org/abs/1108.1791",
    author="Aaronson, Scott",
    item_type="journalArticle"
)
print(f"Created item: {key}")

# Add blog post without URL
key = client.add_item(
    title="AI Safety Research Update",
    url=None,
    author=None,
    item_type="blogPost"
)
```

## get_collections() -> dict[str, CollectionInfo]

List all collections with hierarchy.

**Returns:**
dict[str, CollectionInfo] - Mapping of collection keys to metadata

**Example:**
```python
collections = client.get_collections()

for key, info in collections.items():
    print(f"{info['path']}: {info['name']}")

# Output:
# AI/Machine Learning: Machine Learning
# AI/Robotics: Robotics
# Physics: Physics
```
```

## Why This Works

### Complete Function Signatures
- Full type information
- Optional parameters clearly marked
- Return types specified

### Parameter Tables
- All parameters documented
- Types shown
- Purpose explained clearly

### Return Documentation
- Type specified
- What the value contains
- Structure explained

### Real Code Examples
- Use actual class/function names
- Show multiple use cases
- Include output where helpful
- Demonstrate error handling

### Exception Documentation
- Lists specific exception types
- Explains when they're raised
- Shows how to handle them

### No Marketing
- Direct, factual language
- No "powerful" or "easy to use"
- Focuses on what it does

from fastmcp import FastMCP
from aw_client import ActivityWatchClient
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List
import os

mcp = FastMCP("ActivityWatch")

@mcp.tool
def list_buckets() -> Dict[str, Any]:
    """List all available ActivityWatch buckets. Use this FIRST to get correct bucket IDs."""
    client = ActivityWatchClient("dere-mcp")
    try:
        buckets = client.get_buckets()
        bucket_list = []
        for bucket_id, bucket in buckets.items():
            bucket_list.append({
                "id": bucket_id,
                "type": bucket.get("type", "unknown"),
                "hostname": bucket.get("hostname", "unknown"),
                "client": bucket.get("client", "unknown")
            })
        return {"buckets": bucket_list}
    except Exception as e:
        return {"error": str(e)}

@mcp.tool
def get_events(bucket_id: str, hours_back: int = 24, limit: int = 1000) -> Dict[str, Any]:
    """Get raw event data from a specific ActivityWatch bucket.

    IMPORTANT: Check the activitywatch://buckets resource first to get the correct bucket_id!
    Common buckets: aw-watcher-window_devs, aw-watcher-afk_devs, aw-watcher-spotify_devs

    Args:
        bucket_id: Exact bucket identifier - GET THIS FROM activitywatch://buckets resource!
        hours_back: How many hours of history to retrieve (default 24)
        limit: Maximum number of events to retrieve (default 1000)
    """
    client = ActivityWatchClient("dere-mcp")

    end_time = datetime.now().astimezone()
    start_time = end_time - timedelta(hours=hours_back)

    try:
        events = client.get_events(bucket_id, start=start_time, end=end_time, limit=limit)

        return {
            "bucket_id": bucket_id,
            "time_range_hours": hours_back,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "event_count": len(events),
            "total_duration_seconds": sum(e.duration.total_seconds() for e in events),
            "events": [
                {
                    "timestamp": e.timestamp.isoformat(),
                    "duration_seconds": e.duration.total_seconds(),
                    "data": e.data
                } for e in events
            ]
        }
    except Exception as e:
        return {"error": str(e), "bucket_id": bucket_id}

if __name__ == "__main__":
    mcp.run()
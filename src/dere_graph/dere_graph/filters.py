"""Temporal filtering system for dere_graph queries."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ComparisonOperator(str, Enum):
    """Comparison operators for date filtering."""

    EQUALS = "equals"
    NOT_EQUALS = "not_equals"
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    GREATER_THAN_EQUAL = "greater_than_equal"
    LESS_THAN_EQUAL = "less_than_equal"
    IS_NULL = "is_null"
    IS_NOT_NULL = "is_not_null"


class DateFilter(BaseModel):
    """Filter for date/timestamp fields with comparison operators."""

    operator: ComparisonOperator
    value: datetime | None = None

    def to_cypher_condition(self, field_name: str, param_name: str) -> tuple[str, dict]:
        """Convert filter to Cypher WHERE condition.

        Args:
            field_name: Name of the field to filter (e.g., 'n.valid_at')
            param_name: Name for the parameter in query (e.g., 'valid_at_value')

        Returns:
            Tuple of (cypher_condition, parameters_dict)
        """
        if self.operator == ComparisonOperator.IS_NULL:
            return f"{field_name} IS NULL", {}
        if self.operator == ComparisonOperator.IS_NOT_NULL:
            return f"{field_name} IS NOT NULL", {}

        if self.value is None:
            raise ValueError(f"Value required for operator {self.operator}")

        # Convert datetime to timestamp for Cypher
        timestamp = int(self.value.timestamp())

        operator_map = {
            ComparisonOperator.EQUALS: "=",
            ComparisonOperator.NOT_EQUALS: "<>",
            ComparisonOperator.GREATER_THAN: ">",
            ComparisonOperator.LESS_THAN: "<",
            ComparisonOperator.GREATER_THAN_EQUAL: ">=",
            ComparisonOperator.LESS_THAN_EQUAL: "<=",
        }

        cypher_op = operator_map[self.operator]
        return f"{field_name} {cypher_op} ${param_name}", {param_name: timestamp}


class SearchFilters(BaseModel):
    """Temporal and attribute filters for search queries."""

    # Temporal filters
    valid_at: DateFilter | None = Field(None, description="Filter by when relationship became true")
    invalid_at: DateFilter | None = Field(
        None, description="Filter by when relationship stopped being true"
    )
    created_at: DateFilter | None = Field(None, description="Filter by ingestion time")
    expired_at: DateFilter | None = Field(
        None, description="Filter by when node/edge was marked expired"
    )

    # Label/type filters
    node_labels: list[str] | None = Field(
        None, description="Filter nodes by labels (e.g., ['Person', 'User'])"
    )
    edge_types: list[str] | None = Field(None, description="Filter edges by relationship type")

    # Attribute filters (simple key-value matching)
    node_attributes: dict[str, str | int | float | bool] | None = Field(
        None, description="Filter nodes by attribute values"
    )
    edge_attributes: dict[str, str | int | float | bool] | None = Field(
        None, description="Filter edges by attribute values"
    )

    def to_cypher_conditions(
        self, node_alias: str = "n", edge_alias: str = "r"
    ) -> tuple[list[str], dict]:
        """Convert filters to Cypher WHERE conditions.

        Args:
            node_alias: Alias for node in Cypher query
            edge_alias: Alias for relationship in Cypher query

        Returns:
            Tuple of (list of condition strings, parameters dict)
        """
        conditions = []
        params = {}

        # Temporal filters (work for both nodes and edges)
        if self.valid_at:
            cond, p = self.valid_at.to_cypher_condition(f"{edge_alias}.valid_at", "filter_valid_at")
            conditions.append(cond)
            params.update(p)

        if self.invalid_at:
            cond, p = self.invalid_at.to_cypher_condition(
                f"{edge_alias}.invalid_at", "filter_invalid_at"
            )
            conditions.append(cond)
            params.update(p)

        if self.created_at:
            # Works for both nodes and edges
            cond, p = self.created_at.to_cypher_condition(
                f"{node_alias}.created_at", "filter_created_at"
            )
            conditions.append(cond)
            params.update(p)

        if self.expired_at:
            cond, p = self.expired_at.to_cypher_condition(
                f"{edge_alias}.expired_at", "filter_expired_at"
            )
            conditions.append(cond)
            params.update(p)

        # Label filters
        if self.node_labels:
            # ANY label from list must be present
            label_conditions = [f"'{label}' IN labels({node_alias})" for label in self.node_labels]
            conditions.append(f"({' OR '.join(label_conditions)})")

        if self.edge_types:
            # Edge type must match one from list
            type_conditions = [f"type({edge_alias}) = '{etype}'" for etype in self.edge_types]
            conditions.append(f"({' OR '.join(type_conditions)})")

        # Attribute filters
        if self.node_attributes:
            for key, value in self.node_attributes.items():
                param_name = f"node_attr_{key}"
                conditions.append(f"{node_alias}.{key} = ${param_name}")
                params[param_name] = value

        if self.edge_attributes:
            for key, value in self.edge_attributes.items():
                param_name = f"edge_attr_{key}"
                conditions.append(f"{edge_alias}.{key} = ${param_name}")
                params[param_name] = value

        return conditions, params


def build_temporal_query_clause(
    filters: SearchFilters | None, node_alias: str = "n", edge_alias: str = "r"
) -> tuple[str, dict]:
    """Build Cypher WHERE clause from filters.

    Args:
        filters: Search filters to apply
        node_alias: Alias for node in query
        edge_alias: Alias for relationship in query

    Returns:
        Tuple of (WHERE clause string, parameters dict)
    """
    if not filters:
        return "", {}

    conditions, params = filters.to_cypher_conditions(node_alias, edge_alias)

    if not conditions:
        return "", {}

    where_clause = "WHERE " + " AND ".join(conditions)
    return where_clause, params

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ConfigSchema, ConfigSchemaProperty, ConfigSchemaOption } from "@/types/api";

interface SchemaFieldProps {
  name: string;
  schema: ConfigSchemaProperty;
  value: unknown;
  onChange: (value: unknown) => void;
}

function resolveRef(ref: string, defs: ConfigSchema["$defs"]): ConfigSchemaProperty | undefined {
  const refName = ref.replace("#/$defs/", "");
  return defs[refName] as ConfigSchemaProperty | undefined;
}

function getFieldType(schema: ConfigSchemaProperty): string {
  if (schema.ui_type) return schema.ui_type;
  if (schema.type === "boolean") return "toggle";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.options && schema.options.length > 0) return "select";
  if (schema.anyOf?.some(t => t.type === "null")) {
    const nonNull = schema.anyOf.find(t => t.type !== "null");
    if (nonNull?.type === "boolean") return "toggle";
    if (nonNull?.type === "integer" || nonNull?.type === "number") return "number";
  }
  return "text";
}

function SchemaField({ name, schema, value, onChange }: SchemaFieldProps) {
  const fieldType = getFieldType(schema);
  const title = schema.title || name;
  const description = schema.description || "";
  const suffix = schema.suffix || "";
  const isReadonly = schema.ui_type === "readonly";

  if (fieldType === "hidden") return null;

  if (fieldType === "toggle") {
    return (
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor={name} className="font-medium">{title}</Label>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Switch
          id={name}
          checked={Boolean(value)}
          onCheckedChange={onChange}
          disabled={isReadonly}
        />
      </div>
    );
  }

  if (fieldType === "select" && schema.options) {
    return (
      <div className="grid gap-2">
        <Label htmlFor={name}>{title}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Select
          value={String(value || schema.default || "")}
          onValueChange={onChange}
          disabled={isReadonly}
        >
          <SelectTrigger id={name}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {schema.options.map((opt: ConfigSchemaOption) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (fieldType === "number") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={name}>
          {title}
          {suffix && <span className="text-muted-foreground ml-1">({suffix})</span>}
        </Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Input
          id={name}
          type="number"
          value={value as number ?? schema.default ?? 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={schema.min}
          max={schema.max}
          step={schema.step}
          disabled={isReadonly}
        />
      </div>
    );
  }

  if (fieldType === "readonly") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={name}>{title}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <Input
          id={name}
          value={String(value || "")}
          disabled
          className="font-mono text-sm"
        />
      </div>
    );
  }

  // Default: text input
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{title}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <Input
        id={name}
        value={String(value ?? schema.default ?? "")}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={String(schema.default || "")}
      />
    </div>
  );
}

interface SchemaFormSectionProps {
  sectionKey: string;
  sectionSchema: ConfigSchemaProperty;
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  defs: ConfigSchema["$defs"];
}

export function SchemaFormSection({ sectionKey, sectionSchema, values, onChange, defs }: SchemaFormSectionProps) {
  // Resolve $ref to get actual properties
  const resolvedSchema = sectionSchema.$ref
    ? resolveRef(sectionSchema.$ref, defs)
    : sectionSchema;

  const properties = resolvedSchema?.properties;
  if (!properties) return null;

  // Group fields by ui_group
  const groups = useMemo(() => {
    const grouped: Record<string, Array<{ key: string; schema: ConfigSchemaProperty }>> = {};

    for (const [fieldKey, fieldSchema] of Object.entries(properties)) {
      const group = fieldSchema.ui_group || "default";
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push({ key: fieldKey, schema: fieldSchema });
    }

    // Sort fields within each group by ui_order
    for (const group of Object.values(grouped)) {
      group.sort((a, b) => (a.schema.ui_order || 0) - (b.schema.ui_order || 0));
    }

    return grouped;
  }, [properties]);

  // Filter out hidden fields
  const visibleGroups = useMemo(() => {
    const result: Record<string, Array<{ key: string; schema: ConfigSchemaProperty }>> = {};
    for (const [groupName, fields] of Object.entries(groups)) {
      const visibleFields = fields.filter(f => f.schema.ui_type !== "hidden");
      if (visibleFields.length > 0) {
        result[groupName] = visibleFields;
      }
    }
    return result;
  }, [groups]);

  const groupNames = Object.keys(visibleGroups);

  return (
    <div className="space-y-6">
      {groupNames.map((groupName) => {
        const fields = visibleGroups[groupName];
        const toggleFields = fields.filter(f => getFieldType(f.schema) === "toggle");
        const otherFields = fields.filter(f => getFieldType(f.schema) !== "toggle");

        return (
          <div key={groupName} className="space-y-4">
            {/* Toggle fields in a grid */}
            {toggleFields.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {toggleFields.map(({ key, schema }) => (
                  <SchemaField
                    key={key}
                    name={`${sectionKey}-${key}`}
                    schema={schema}
                    value={values[key]}
                    onChange={(v) => onChange(key, v)}
                  />
                ))}
              </div>
            )}

            {/* Other fields */}
            {otherFields.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherFields.map(({ key, schema }) => (
                  <SchemaField
                    key={key}
                    name={`${sectionKey}-${key}`}
                    schema={schema}
                    value={values[key]}
                    onChange={(v) => onChange(key, v)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

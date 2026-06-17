# Where + 关联参数化 + Delete 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 typeql 的 where 支持多级关联查询，关联列表字段支持分页/排序/筛选参数，修复 delete 返回空值报错。

**Architecture:** 三个独立但同批次的功能模块：(1) 在 filter input type 生成中加入 relation 递归嵌套，(2) 在 output type 的关系字段上附加 args，(3) 用 DeleteResult 类型替代原 delete 返回的实体列表。三者共享 relationMap 和元数据基础设施。

**Tech Stack:** TypeScript, GraphQL (graphql-js), TypeORM

---

### Task 1: 模块级 filter/order 缓存 + DeleteResult 类型 + 关系 filter 递归生成

**Files:**

- Modify: `src/builders/common.ts`

**说明：** 这是最核心的改动，需要在 `common.ts` 中完成三件事：

1. 新增模块级 `relationFilterCache` / `relationOrderCache` Map，供后续 output type 构建字段 args 时读取
2. 新增 `GraphQLObjectType` 类型的 `DeleteResult` 供 delete mutation 使用
3. 在 `buildTableTypes()` 中递归生成关联实体的 filter input，支持 nested relation filter + visitedEntities 循环保护

- [ ] **Step 1: 添加模块级缓存 Map 和 DeleteResult 类型**

在 `relationResolvers` 定义之后、`typeCache` 之前插入以下代码：

```typescript
// ── Relation filter/order cache for field arguments ──
export const relationFilterCache = new Map<string, GraphQLInputObjectType>();
export const relationOrderCache = new Map<string, GraphQLInputObjectType>();

// ── DeleteResult type ──
export const deleteResultType = new GraphQLObjectType({
  name: 'DeleteResult',
  fields: {
    affected: { type: new GraphQLNonNull(GraphQLInt) },
    raw: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
  },
});
```

- [ ] **Step 2: 新增 `generateRelationFilter()` 递归函数**

在 `classifyColumn()` 之后、`relationResolvers` 之前，新增以下函数：

```typescript
function generateRelationFilter(
  entityName: string,
  meta: EntityMetadata,
  entityMap: Record<string, EntityMetadata>,
  relationMap: RelationMap,
  visitedEntities: Set<string>,
  depthLimit: number,
  currentDepth: number,
): GraphQLInputObjectType | null {
  // Guard: depth limit
  if (currentDepth > depthLimit) return null;

  const filterName = `${entityName}_RelationFilter`;
  const classifyFn = classifyColumn(meta);
  const columns = meta.ownColumns;

  // Build scalar filter fields
  const filterFields: Record<string, any> = {};
  for (const col of columns) {
    const cat = classifyFn(col.propertyName);
    let filterType: GraphQLInputObjectType;
    switch (cat) {
      case 'float':
        filterType = getOrCreateSharedFilter('Float', floatFilterFields);
        break;
      case 'boolean':
        filterType = getOrCreateSharedFilter('Boolean', booleanFilterFields);
        break;
      case 'date':
        filterType = getOrCreateSharedFilter('Date', dateFilterFields);
        break;
      case 'datetime':
        filterType = getOrCreateSharedFilter('DateTime', dateTimeFilterFields);
        break;
      case 'enum':
        filterType = makeEnumFilter(col, entityName);
        break;
      case 'int':
        filterType = getOrCreateSharedFilter('Int', intFilterFields);
        break;
      default:
        filterType = getOrCreateSharedFilter('String', stringFilterFields);
    }
    filterFields[col.propertyName] = { type: filterType };
  }

  // Build relation filter fields (recursive with cycle guard)
  const rels = relationMap[entityName] ?? {};
  for (const [relName, relInfo] of Object.entries(rels)) {
    const targetEntityName = relInfo.targetEntityName;
    if (visitedEntities.has(targetEntityName)) continue;
    visitedEntities.add(targetEntityName);
    const targetMeta = entityMap[targetEntityName];
    if (!targetMeta) {
      visitedEntities.delete(targetEntityName);
      continue;
    }
    const subFilter = generateRelationFilter(
      `${entityName}_${relName}`,
      targetMeta,
      entityMap,
      relationMap,
      visitedEntities,
      depthLimit,
      currentDepth + 1,
    );
    visitedEntities.delete(targetEntityName);
    if (subFilter) {
      filterFields[relName] = { type: subFilter };
    }
  }

  return new GraphQLInputObjectType({
    name: filterName,
    fields: () => {
      const orType = new GraphQLInputObjectType({
        name: `${filterName}_Or`,
        fields: () => ({ ...filterFields }),
      });
      return {
        ...filterFields,
        or: { type: new GraphQLList(new GraphQLNonNull(orType)) },
      };
    },
  });
}
```

- [ ] **Step 3: 修改 `buildTableTypes()` 加入 relation filter**

在 filter fields 构建完成后，找到 `filterFields[col.propertyName] = { type: filterType }` 的循环之后，加入 relation filter fields：

```typescript
// ... 在 filter 的列字段构建循环后面 ...
// ── Relation filter fields ──
const rels = relationMap[entityName] ?? {};
const visitedEntities = new Set<string>([entityName]);
for (const [relName, relInfo] of Object.entries(rels)) {
  const targetEntityName = relInfo.targetEntityName;
  if (visitedEntities.has(targetEntityName)) continue;
  visitedEntities.add(targetEntityName);
  const targetMeta = entityMap[targetEntityName];
  if (!targetMeta) {
    visitedEntities.delete(targetEntityName);
    continue;
  }
  const subFilter = generateRelationFilter(
    `${typeName}_${relName}`,
    targetMeta,
    entityMap,
    relationMap,
    visitedEntities,
    2, // default depth limit — TODO: make configurable later
    0,
  );
  visitedEntities.delete(targetEntityName);
  if (subFilter) {
    filterFields[relName] = { type: subFilter };
  }
}
```

- [ ] **Step 4: 在 filter 和 order 生成后填充缓存**

找到 filterInput 创建后的位置，以及 orderInput 创建后的位置，添加缓存填充：

```typescript
// 在 filterInput 赋值后
relationFilterCache.set(entityName, filterInput);

// 在 orderInput 赋值后
relationOrderCache.set(entityName, orderInput);
```

- [ ] **Step 5: 缓存 + DeleteResult 导出**

确保 `relationFilterCache`、`relationOrderCache`、`deleteResultType` 被导出：

```typescript
// 在文件顶部或 export 区域确认
export { relationFilterCache, relationOrderCache, deleteResultType };
```

- [ ] **Step 6: 构建验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(common): add relation filter generation, filter/order cache, DeleteResult type"
```

---

### Task 2: output type 关系字段添加 args

**Files:**

- Modify: `src/builders/common.ts`
- Modify: `src/builders/types.ts` (辅助类型)

- [ ] **Step 1: 更新 `buildOrGetType()` 签名，接收整个 entityMap 即可（已接收）**

`buildOrGetType` 已接收 `entityMap`、`relationMap`、`typeNameMapper`。只需要在函数内部读取 `relationFilterCache` / `relationOrderCache`。

找到字段构建的 relation 循环（`for (const [relName, relInfo] of Object.entries(relations))`），对列表关系添加 args：

```typescript
// 修改前：
if (info.isOne) {
  fields[relName] = { type: targetType, resolve: fieldResolver };
} else {
  fields[relName] = {
    type: new GraphQLList(new GraphQLNonNull(targetType)),
    resolve: fieldResolver,
  };
}

// 修改后：
if (info.isOne) {
  fields[relName] = { type: targetType, resolve: fieldResolver };
} else {
  // 列表关联：加上 where / orderBy / limit / offset 参数
  const targetFilter = relationFilterCache.get(info.targetEntityName);
  const targetOrder = relationOrderCache.get(info.targetEntityName);
  const relArgs: Record<string, any> = {};
  if (targetFilter) relArgs['where'] = { type: targetFilter };
  if (targetOrder) relArgs['orderBy'] = { type: targetOrder };
  relArgs['limit'] = { type: GraphQLInt };
  relArgs['offset'] = { type: GraphQLInt };
  fields[relName] = {
    type: new GraphQLList(new GraphQLNonNull(targetType)),
    args: relArgs,
    resolve: fieldResolver,
  };
}
```

- [ ] **Step 2: 构建验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(common): add filter/order/limit/offset args to list relation fields"
```

---

### Task 3: resolvers.ts — where 多级关联解析 + 关系解析器支持 args + delete 修复

**Files:**

- Modify: `src/builders/resolvers.ts`

- [ ] **Step 1: 更新 `resolveWhere()` 支持 relation 路径**

将 `resolveWhere` 签名从 `(argsWhere, columns)` 改为 `(argsWhere, meta, relationMap)`。内部需区分 ownColumn 和 relation：

```typescript
function resolveWhere(
  argsWhere: any,
  meta: EntityMetadata,
  relationMap: RelationMap,
): { where: Record<string, any>; relations: string[] } {
  if (!argsWhere) return { where: undefined as any, relations: [] };

  const columns = meta.ownColumns;
  const result: Record<string, any> = {};
  const relations: string[] = [];

  // 处理 or 条件
  if (argsWhere.or || argsWhere.OR) {
    const orKey = argsWhere.or ? 'or' : 'OR';
    const orParts = argsWhere[orKey] as any[];
    if (orParts?.length) {
      result[orKey] = orParts
        .map((w: any) => resolveWhere(w, meta, relationMap))
        .filter((r) => r.where != null)
        .map((r) => {
          relations.push(...r.relations);
          return r.where;
        });
      if (result[orKey].length === 0) delete result[orKey];
    }
    // 继续处理其他非 or 字段
  }

  for (const [key, value] of Object.entries(argsWhere)) {
    if (key === 'or' || key === 'OR') continue;
    if (value == null) continue;

    // Check if this is a relation key
    const relInfo = relationMap[meta.targetName]?.[key];
    if (relInfo) {
      // Relation filter — recursively resolve
      const targetMeta = relInfo.relation.inverseEntityMetadata;
      const sub = resolveWhere(value as any, targetMeta, relationMap);
      if (sub.where) {
        result[key] = sub.where;
        relations.push(key);
        // Add nested relation paths
        relations.push(...sub.relations.map((r: string) => `${key}.${r}`));
      }
      continue;
    }

    // ownColumn filter with operators
    if (typeof value === 'object' && value !== null) {
      const col = columns.find((c: any) => c.propertyName === key);
      if (!col) continue;
      for (const [op, val] of Object.entries(value as Record<string, any>)) {
        if (val === undefined || val === null) continue;
        switch (op) {
          case 'eq':
            result[key] = val;
            break;
          case 'ne':
            result[key] = Not(val);
            break;
          case 'lt':
            result[key] = LessThan(val);
            break;
          case 'lte':
            result[key] = LessThanOrEqual(val);
            break;
          case 'gt':
            result[key] = MoreThan(val);
            break;
          case 'gte':
            result[key] = MoreThanOrEqual(val);
            break;
          case 'like':
            result[key] = Like(val);
            break;
          case 'notLike':
            result[key] = Not(Like(val));
            break;
          case 'ilike':
            result[key] = Like(val);
            break;
          case 'notIlike':
            result[key] = Not(Like(val));
            break;
          case 'inArray':
          case 'in':
            result[key] = In(Array.isArray(val) ? val : [val]);
            break;
          case 'notInArray':
          case 'notIn':
            result[key] = Not(In(Array.isArray(val) ? val : [val]));
            break;
          case 'isNull':
            result[key] = IsNull();
            break;
          case 'isNotNull':
            result[key] = Not(IsNull());
            break;
        }
      }
    }
  }

  const where = Object.keys(result).length > 0 ? result : undefined;
  return { where, relations };
}
```

同时删除原 `convertFilters()` 函数（其逻辑已合并到 `resolveWhere()` 中）。

- [ ] **Step 2: 更新所有调用 `resolveWhere()` 的位置**

一共 5 处调用：`makeList`、`makeSingle`、`makeUpdate`、`makeDelete`、关系解析器（新增）。

每处修改方式如下：

**makeList:**

```typescript
resolve: async (_s: any, args: any) => {
  const repo = ds.getRepository(target as any);
  const resolved = resolveWhere(args['where'], meta, relationMap);
  return remapToGraphQLArrayOutput(await repo.find({
    where: resolved.where as any,
    relations: resolved.relations.length > 0 ? resolved.relations : undefined as any,
    order: convertOrderBy(args['orderBy']) as any,
    skip: args['offset'] ?? undefined,
    take: args['limit'] ?? undefined,
  }) as any);
},
```

**makeSingle:**

```typescript
resolve: async (_s: any, args: any) => {
  const repo = ds.getRepository(target as any);
  const resolved = resolveWhere(args['where'], meta, relationMap);
  const result = await repo.findOne({
    where: resolved.where as any,
    relations: resolved.relations.length > 0 ? resolved.relations : undefined as any,
    order: convertOrderBy(args['orderBy']) as any,
  } as any);
  if (!result) return null;
  return remapToGraphQLSingleOutput(result as any);
},
```

**makeUpdate:**

```typescript
resolve: async (_s: any, args: any) => {
  const repo = ds.getRepository(target as any);
  const resolved = resolveWhere(args['where'], meta, relationMap);
  const entities = await repo.find({
    where: resolved.where as any,
    relations: resolved.relations.length > 0 ? resolved.relations : undefined as any,
  });
  if (!entities.length) return [];
  const mapped = remapFromGraphQLSingleInput(args['set'] as any, cols as any);
  for (const e of entities) Object.assign(e, mapped);
  return remapToGraphQLArrayOutput(await repo.save(entities) as any);
},
```

**makeDelete:**

```typescript
function makeDelete(
  ds: DataSource,
  meta: EntityMetadata,
  fi: GraphQLInputObjectType | undefined,
  _lt: any,
  cols: EntityMetadata['ownColumns'],
  relationMap: RelationMap,
): any {
  const target = meta.target;
  const args: Record<string, any> = {};
  if (fi) args['where'] = { type: fi };
  return {
    type: deleteResultType,
    args,
    resolve: async (_s: any, args: any) => {
      const repo = ds.getRepository(target as any);
      const resolved = resolveWhere(args['where'], meta, relationMap);
      if (!resolved.where) return { affected: 0, raw: [] };
      const result = await repo.delete(resolved.where as any);
      return {
        affected: result.affected ?? 0,
        raw: (result.raw ?? []).map((r: any) => String(r)),
      };
    },
  };
}
```

然后在 `generateResolvers()` 中调用 `makeDelete` 时传入 `relationMap`：

```typescript
mutations[names.deleteFieldName] = makeDelete(
  dataSource,
  meta,
  filterInput,
  listType,
  columns,
  relationMap,
);
```

还需要在文件顶部导入 `deleteResultType` 和 `relationFilterCache`、`relationOrderCache`（last one for relation resolver）。

还需要在 `generateResolvers` 中传递 `relationMap` 到 `makeDelete` 签名。

- [ ] **Step 3: 更新 `createRelationResolver()` 支持 args**

核心改动：当关系字段带有 `where`/`orderBy`/`limit`/`offset` 参数时，退化为直接查询（不使用 batch loader）。

```typescript
function createRelationResolver(
  ds: DataSource,
  meta: EntityMetadata,
  relInfo: any,
  relationMap: RelationMap,
): (...args: any[]) => Promise<any> {
  // ... 现有变量定义保持不变 ...

  return async (source: any, args: any, context: any) => {
    const propertyName = relInfo.relation.propertyName;

    // Check if args are provided — if so, bypass batch loading
    const hasArgs =
      args &&
      (args.where ||
        args.orderBy ||
        args.limit !== undefined ||
        args.offset !== undefined);

    if (source[propertyName] !== undefined && !hasArgs) {
      return source[propertyName];
    }

    const srcPkCol = meta.primaryColumns[0];
    if (!srcPkCol) return isList ? [] : null;

    // Parse relation args
    let resolvedWhere: any = undefined;
    let resolvedRelations: string[] | undefined = undefined;
    if (args?.where) {
      const targetMeta = relInfo.relation.inverseEntityMetadata;
      const resolved = resolveWhere(args.where, targetMeta, relationMap);
      resolvedWhere = resolved.where;
      resolvedRelations =
        resolved.relations.length > 0 ? resolved.relations : undefined;
    }
    const order = args?.orderBy ? convertOrderBy(args.orderBy) : undefined;
    const take = args?.limit ?? undefined;
    const skip = args?.offset ?? undefined;

    if (isManyToMany) {
      const pkValue = source[srcPkCol.propertyName];
      if (pkValue == null) return [];
      const jt = relInfo.relation.junctionEntityMetadata?.tableName;
      const jc = relInfo.relation.joinColumns?.[0]?.propertyName;
      const tpk = targetPk?.propertyName;
      if (!jt || !jc || !tpk) return [];

      let query = targetRepo
        .createQueryBuilder('t')
        .innerJoin(jt, 'j', `"j"."${tpk}" = "t"."${tpk}"`)
        .where(`"j"."${jc}" IN (:...ids)`, { ids: [pkValue] });

      if (resolvedWhere) {
        // Apply where clauses — for simplicity, convert FindOperator to WHERE clause
        // TypeORM QueryBuilder accepts FindOptionsWhere via AndWhere
        // Actually use find() instead for parameter consistency
        return targetRepo.find({
          where: { ...resolvedWhere, [fkPropertyName!]: pkValue } as any,
          order: order as any,
          take,
          skip,
        });
      }

      if (order) query = query.orderBy(order);
      if (take) query = query.take(take);
      if (skip) query = query.skip(skip);

      return query.getMany();
    }

    if (relInfo.isOwning) {
      // ManyToOne — ignore args (single entity), keep batch loader
      const fkValue = fkPropertyName ? source[fkPropertyName] : undefined;
      if (fkValue == null) return null;
      const targetPkName = targetPk?.propertyName;
      if (!targetPkName) return null;

      const loader = getOrCreateLoader(
        `${meta.targetName}::${propertyName}`,
        `${meta.targetName}::${propertyName}`,
        async (keys: readonly any[]) => {
          const unique = [...new Set(keys)];
          const results = await (targetRepo as any).find({
            where: { [targetPkName]: In(unique) },
          });
          const byId = new Map(
            results.map((r: any) => [String(r[targetPkName]), r]),
          );
          return keys.map((k) => byId.get(String(k)) ?? null);
        },
      );
      return loader.load(fkValue);
    } else {
      // OneToMany — check hasArgs
      const pkValue = source[srcPkCol.propertyName];
      if (pkValue == null || !fkPropertyName) return [];

      if (hasArgs) {
        // Direct query with args
        const whereClause = resolvedWhere
          ? { ...resolvedWhere, [fkPropertyName!]: pkValue }
          : ({ [fkPropertyName!]: pkValue } as any);
        return (targetRepo as any).find({
          where: whereClause,
          order: order as any,
          take,
          skip,
          relations: resolvedRelations,
        });
      }

      // Batch loaded (no args)
      const loader = getOrCreateLoader(
        `${meta.targetName}::${propertyName}`,
        `${meta.targetName}::${propertyName}`,
        async (keys: readonly any[]) => {
          const unique = [...new Set(keys)];
          const results = await (targetRepo as any).find({
            where: { [fkPropertyName!]: In(unique) },
          });
          const grouped = new Map<string, any[]>();
          for (const id of unique) grouped.set(String(id), []);
          for (const row of results) {
            const pid = (row as any)[fkPropertyName!];
            if (pid !== undefined) grouped.get(String(pid))?.push(row);
          }
          return keys.map((k) => grouped.get(String(k)) ?? []);
        },
      );
      return loader.load(pkValue);
    }
  };
}
```

- [ ] **Step 4: 更新 `generateResolvers()` 中 `createRelationResolver` 调用传入 `relationMap`**

```typescript
resolvers[relName] = createRelationResolver(
  dataSource,
  meta,
  relInfo,
  relationMap,
);
```

- [ ] **Step 5: 更新文件导入**

在文件顶部添加新导入：

```typescript
import {
  type RelationMap,
  generateTypes,
  registerFieldResolver,
  deleteResultType,
  relationFilterCache,
} from './common.ts';
```

- [ ] **Step 6: 构建验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(resolvers): nested relation where, relation field args, delete result type"
```

---

### Task 4: 配置项扩展

**Files:**

- Modify: `src/types.ts`
- Modify: `src/buildSchema.ts`

- [ ] **Step 1: 在 `BuildSchemaConfig` 中添加 `maxRelationDepth` 配置**

```typescript
export interface BuildSchemaConfig {
  // ... 现有配置 ...

  /**
   * Maximum depth for relation filter generation in nested where queries.
   * Default: 2 (e.g., article -> author -> profile)
   * Set to 0 to disable nested relation filtering entirely.
   */
  maxRelationDepth?: number;
}
```

- [ ] **Step 2: 将配置传递到 `buildTableTypes` 和 `generateTypes`**

在 `buildSchema.ts` 传递给 `generateTypes` 时使用:

```typescript
const typeOutputs = generateTypes(
  entityMetadatas,
  entityMap,
  relationMap,
  typeNameMapper,
  config.maxRelationDepth ?? 2,
);
```

在 `common.ts` 的 `generateTypes` 和 `buildTableTypes` 签名中新增 `relationDepth` 参数，在调用 `generateRelationFilter` 时传入。

- [ ] **Step 3: 构建验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(config): add maxRelationDepth config option"
```

---

### Task 5: 验证 end-to-end

- [ ] **Step 1: 启动 example server 测试基础 CRUD 不变**

```bash
cd /home/tuzi/VSCodeProjects/typeql
# Check the example server first
cat tool/example-server.ts | head -40
```

确认 example server 仍能启动且基础查询/创建/更新/删除正常工作。

- [ ] **Step 2: 测试 delete 修复**

启动 example server 后，发送 delete mutation 确认返回 `{ affected }` 而非报错。

- [ ] **Step 3: 测试多级关联 where**

构造包含至少两层关系筛选的 GraphQL 查询并验证结果正确。

- [ ] **Step 4: 测试关联字段参数化**

查询列表时在列表关联字段上传递 `limit`/`offset`/`where`，确认返回正确。

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify end-to-end all three features"
```

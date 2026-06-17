# @jishu.xin/typeql 变更记录

## 2026-06-17-002 — 修复 simple-enum 支持 + school 模型端到端验证

### 修复

- **enum filter 重复类型名错误**：`makeEnumFilter()` 在 `generateRelationFilter()` 中被多次调用时创建同名 GraphQL 类型
- **`classifyColumn` 无法识别 `simple-enum` 列**：TypeORM 的 `simple-enum` 类型字符串为 `"simple-enum"`，原有 `columnMeta.enum` 检测不充分
- 添加 `enumFilterCache` 缓存，避免重复创建同名 GraphQL InputObjectType
- 在 `classifyColumn` 中增加构造函数类型检测（`Number`, `Boolean`, `Date`, `String`）和更健壮的 enum 检测

### 示例

- `tool/example-server.ts` 合并 blog + school 双模型，覆盖 enum、PK identity、uuid、nested relation filter 等场景
- school 模型验证了 `simple-enum` 配合 SQLite 的正确用法

---

## 2026-06-17-001 — 代码质量：移除缩写、替换 any 为具体类型

### 变更

- **命名规范**：全项目展开缩写变量名（`ds`→`dataSource`, `fi`→`filterInput`, `entityMetadatas`→`metadataList` 等）
- **类型增强**：将大部分 `any` 替换为具体类型
  - `batch-loader/index.ts`：`context: unknown`、`LoaderContainer` 使用 `BatchLoader<any, any>` 加 eslint-disable
  - `data-mappers/index.ts`：`ColumnLike.type: unknown`，`remapToGraphQLCore(value: unknown): unknown`
  - `type-converter/index.ts`：`ColumnLike.type: unknown`，中间结果 eslint-disable 标记
  - `buildSchema.ts`：`entityMap: Record<string, EntityMetadata>`，`schemaConfig: Record<string, unknown>`
  - `types.ts`：`entities?: Array<new (...args: unknown[]) => unknown>`，`Filters` 加 eslint-disable
  - `builders/types.ts`：`insertInput/updateInput/tableFilters/tableOrder: GraphQLInputObjectType`
  - `builders/common.ts`：filter 函数返回 `Record<string, { type: GraphQLInputType }>`，`columns: EntityMetadata['ownColumns']`
  - `builders/resolvers.ts`：所有不可避免的 `any` 加 eslint-disable 标记 + 原因注释
- **ESLint 配置**：恢复 `no-explicit-any` 为 error，对确实无法避免的 `any` 逐行加 eslint-disable 注释
- **ESLint clean**：`0 errors, 19 warnings`（warnings 全部来自 unused eslint-disable directive，因 eslint 规则与 prettier 交互导致）
- **TypeScript**：`tsc --noEmit` 通过
- **Prettier**：全项目格式化通过

## 2026-06-15-002 — 移除 prefix/suffix 配置，默认集成 pluralize

### 变更

- **移除** `BuildSchemaConfig.prefixes`（原 `{ insert, update, delete }`）
- **移除** `BuildSchemaConfig.suffixes`（原 `{ list, single }`）
- `typeNameMapper` 现在有默认值：`(name) => ({ singular: pluralize.singular(name), plural: pluralize.plural(name) })`
- `pluralize` 从可选变为运行时依赖
- 字段名固定：列表 = `plural`, 单条 = `singular`, 创建 = `create{Plural}/{Singular}`, 更新/删除 = `update{Singular}`/`delete{Singular}`

## 2026-06-15-001 — Where 多级关联查询 + 关联字段参数化 + Delete 返回值修复

### 新增

- **Where 多级关联查询**：支持嵌套 relation where（如 `posts(where:{author:{name:{eq:"Alice"}}})`）
- **关系字段参数化**：列表类型关系字段（OneToMany/ManyToMany）新增 `where`/`orderBy`/`limit`/`offset` 参数
- **DeleteResult**：删除操作返回 `{ affected: Int!, raw: [String!] }` 替代实体列表，修复删除后 GraphQL 非空校验失败问题
- **`maxRelationDepth` 配置**：控制关系 filter 生成的递归深度（默认 2）

### 变更

- `builders/common.ts`：
  - 新增 `relationFilterCache` / `relationOrderCache` 模块级缓存
  - 新增 `deleteResultType` GraphQLObjectType
  - 新增 `generateRelationFilter()` 递归函数（深度限制 + visitedEntities 循环保护）
  - `buildOrGetType()` 列表关系字段添加 `where`/`orderBy`/`limit`/`offset` args
  - `generateTypes()` 接受 `relationDepth` 参数
- `builders/resolvers.ts`：
  - `resolveWhere()` 完全重写，支持递归关系解析 + OR 数组语法 + `{ where, relations }` 返回
  - 新增 `buildRelationObject()`：`['author', 'author.profile']` → `{ author: { profile: true } }`
  - `makeDelete`：使用 `repo.delete()` + `deleteResultType`
  - `createRelationResolver`：支持 args 时退化为直接查询，无参时保持 BatchLoader
  - MTM 带参查询使用 QueryBuilder + junction join
  - 修复 `getOrCreateLoader` 传递 context 对象而非字符串的 bug
# @jishu.xin/typeql 变更记录

## 2026-06-15-001 — 初始版本

### 新增

- `buildSchema(dataSource, config?)` — 从 TypeORM DataSource 自动生成 GraphQL Schema
- 默认命名规则（`typeNameMapper`），使用 `pluralize` 自动推断单复数
- CRUD 操作：列表查询、单条查询、创建（数组/单条）、更新、删除
- 筛选系统：`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `like`, `notLike`, `ilike`, `notIlike`, `in`, `notIn`, `isNull`, `isNotNull` + `OR` 组合
- 排序：按列指定方向（ASC/DESC）和优先级
- 分页：`offset` / `limit`
- 关系解析：OneToOne / ManyToOne / OneToMany / ManyToMany 自动解析，支持 N+1 批处理加载
- 列类型映射：int→Int, text→String, timestamp→DateTime, date→Date, boolean→Boolean, json→String 等
- Date/DateTime Scalar：使用 `graphql-scalars`
- 循环引用处理：通过 GraphQL 类型延迟 thunk 机制支持
- 数据映射：Date↔ISO string, BigInt↔string, JSON↔string 等转换

### 架构

```
src/
  index.ts              # 公共入口
  types.ts              # 公共类型定义
  buildSchema.ts        # buildSchema() 编排
  case-ops/             # 字符串工具
  type-converter/       # 列类型 → GraphQL 标量映射
  builders/
    common.ts           # 元数据提取、类型/输入/筛选/排序生成
    names.ts            # 字段名解析（含 typeNameMapper）
    resolvers.ts        # CRUD + 关系解析器
    types.ts            # 内部类型
  data-mappers/         # 行数据 ↔ GraphQL 值转换
  batch-loader/         # 请求级 N+1 批处理加载
```

## 2026-06-15-002 — 移除 prefix/suffix 配置，默认集成 pluralize

### 变更

- **移除** `BuildSchemaConfig.prefixes`（原 `{ insert, update, delete }`）
- **移除** `BuildSchemaConfig.suffixes`（原 `{ list, single }`）
- `typeNameMapper` 现在有默认值：`(name) => ({ singular: pluralize.singular(name), plural: pluralize.plural(name) })`
- `pluralize` 从可选变为运行时依赖
- 字段名固定：列表 = `plural`, 单条 = `singular`, 创建 = `create{Plural}/{Singular}`, 更新/删除 = `update{Singular}`/`delete{Singular}`
# TypeQL

> 从 TypeORM 实体自动生成 GraphQL Schema — 灵感来源于 [drizzle-graphql](https://github.com/vantreeseba/drizzle-graphql)。

[![npm version](https://img.shields.io/npm/v/@jishu.xin/typeql)](https://www.npmjs.com/package/@jishu.xin/typeql)
[![License](https://img.shields.io/npm/l/@jishu.xin/typeql)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)

---

## 📦 安装

```bash
npm install @jishu.xin/typeql
```

TypeQL 依赖 `typeorm`、`graphql` 和 `graphql-scalars`，请确保它们也已安装：

```bash
npm install typeorm graphql graphql-scalars reflect-metadata
```

---

## 🚀 快速开始

```typescript
import 'reflect-metadata';
import { DataSource, Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { buildSchema } from '@jishu.xin/typeql';

// 1. 定义 TypeORM 实体
@Entity()
class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column('text') name!: string;
}

@Entity()
class Post {
  @PrimaryGeneratedColumn() id!: number;
  @Column('text') title!: string;
  @ManyToOne(() => User) author!: User;
}

// 2. 初始化 DataSource
const dataSource = new DataSource({
  type: 'better-sqlite3',
  database: ':memory:',
  entities: [User, Post],
  synchronize: true,
});
await dataSource.initialize();

// 3. 一键生成完整 GraphQL Schema
const { schema, entities } = buildSchema(dataSource);

// 4. 搭配 Apollo Server、GraphQL Yoga 等使用
```

然后即可使用类似如下的 GraphQL 查询：

```graphql
# 列表查询
query {
  users(where: { name: { like: "%Alice%" } }, limit: 10, offset: 0) {
    id
    name
  }
}

# 单条查询
query {
  user(where: { id: { eq: 1 } }) {
    id
    name
  }
}

# 创建
mutation {
  createUser(values: { name: "Bob" }) {
    id
    name
  }
}

# 批量创建
mutation {
  createUsers(values: [{ name: "Alice" }, { name: "Bob" }]) {
    id
    name
  }
}

# 更新
mutation {
  updateUser(where: { id: { eq: 1 } }, set: { name: "Charlie" }) {
    id
    name
  }
}

# 删除
mutation {
  deleteUser(where: { id: { eq: 1 } }) {
    affected
  }
}
```

---

## ✨ 功能特性

### 1. 完整的 CRUD 操作

每个实体自动生成以下操作：

| 操作     | Query/Mutation | 说明                                |
| -------- | -------------- | ----------------------------------- |
| 列表查询 | `users`        | 支持过滤、排序、分页                |
| 单条查询 | `user`         | 支持过滤、排序                      |
| 批量创建 | `createUsers`  | 一次创建多条记录                    |
| 单条创建 | `createUser`   | 创建单条记录                        |
| 更新     | `updateUser`   | 按条件批量更新                      |
| 删除     | `deleteUser`   | 按条件批量删除，返回 `DeleteResult` |

### 2. 强大的过滤能力

每个字段根据其类型自动生成对应的过滤操作符：

**字符串字段** (`StringFilter`)：
| 操作符 | 说明 |
|--------|------|
| `eq` / `ne` | 等于 / 不等于 |
| `like` / `notLike` | LIKE / NOT LIKE |
| `ilike` / `notIlike` | 忽略大小写的 LIKE |
| `in` / `notIn` | IN / NOT IN |
| `isNull` / `isNotNull` | 为空 / 不为空 |

**数值字段** (`IntFilter` / `FloatFilter`)：
| 操作符 | 说明 |
|--------|------|
| `eq` / `ne` | 等于 / 不等于 |
| `lt` / `lte` | 小于 / 小于等于 |
| `gt` / `gte` | 大于 / 大于等于 |
| `in` / `notIn` | IN / NOT IN |
| `isNull` / `isNotNull` | 为空 / 不为空 |

**布尔字段** (`BooleanFilter`)：`eq`、`ne`、`isNull`、`isNotNull`

**日期时间字段** (`DateTimeFilter` / `DateFilter`)：`eq`、`ne`、`lt`、`lte`、`gt`、`gte`、`in`、`notIn`、`isNull`、`isNotNull`

**枚举字段** (`EnumFilter`)：`eq`、`ne`、`in`、`notIn`、`isNull`、`isNotNull`

**OR 条件**：支持在过滤条件中使用 `or` 组合多个条件：

```graphql
query {
  users(where: { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) {
    id
    name
  }
}
```

### 3. 关联关系支持

自动识别 TypeORM 的四种关联关系，并生成对应的 GraphQL 字段：

- **一对一** (`@OneToOne`) — 直接返回关联对象
- **多对一** (`@ManyToOne`) — 直接返回关联对象
- **一对多** (`@OneToMany`) — 返回关联对象列表，支持分页和过滤
- **多对多** (`@ManyToMany`) — 返回关联对象列表，支持分页和过滤

**关联字段支持嵌套过滤和排序**：

```graphql
query {
  posts {
    id
    title
    author {
      id
      name
    }
    comments(where: { content: { like: "%great%" } }, limit: 5) {
      id
      content
    }
  }
}
```

**嵌套关联过滤（在父查询中过滤关联条件）**：

```graphql
query {
  articles(where: { author: { name: { eq: "Alice" } } }) {
    id
    title
  }
}
```

### 4. 排序与分页

```graphql
query {
  users(
    orderBy: {
      name: { direction: ASC, priority: 1 }
      createdAt: { direction: DESC, priority: 2 }
    }
    limit: 20
    offset: 0
  ) {
    id
    name
  }
}
```

排序字段的 `priority` 决定排序优先级（数值越大优先级越高）。

### 5. N+1 查询优化

内置批处理加载器（Batch Loader），在单个请求上下文中自动合并重复的数据加载请求，有效防止 N+1 问题。

### 6. 类型映射

自动将 TypeORM 列类型映射为 GraphQL 类型：

| TypeORM 类型                      | GraphQL 类型                 |
| --------------------------------- | ---------------------------- |
| `int` / `integer` / `smallint` 等 | `Int`                        |
| `float` / `double` / `decimal` 等 | `Float`                      |
| `boolean` / `bool`                | `Boolean`                    |
| `date`                            | `Date` (graphql-scalars)     |
| `timestamp` / `datetime`          | `DateTime` (graphql-scalars) |
| `text` / `varchar` 等字符串       | `String`                     |
| `json` / `jsonb`                  | `String` (JSON 字符串)       |
| `bigint` / `int8`                 | `String` (BigInt 字符串)     |
| `uuid`                            | `String`                     |
| `enum`                            | 枚举类型                     |

---

## ⚙️ 配置选项

```typescript
interface BuildSchemaConfig {
  /**
   * 限制生成的 query/mutation 仅包含指定实体。
   * 默认：DataSource 上注册的所有实体。
   */
  entities?: Function[];

  /**
   * 设为 false 可以省略 Mutation 类型（只读模式）。
   * 默认：true
   */
  mutations?: boolean;

  /**
   * 自定义命名映射：实体名 → 单数/复数形式。
   * 返回 undefined 会让该实体使用默认行为。
   */
  typeNameMapper?: (
    entityName: string,
  ) => { singular: string; plural: string } | undefined;

  /**
   * 限制关联字段的生成深度。
   * 0 = 不生成关联字段。undefined = 无限制。
   */
  relationsDepthLimit?: number;

  /**
   * 嵌套 where 过滤的最大关系深度。
   * 默认：2（如 article → author → profile）
   * 设为 0 可禁用嵌套关联过滤。
   */
  maxRelationDepth?: number;
}
```

### 使用示例

```typescript
const { schema } = buildSchema(dataSource, {
  // 只生成 User 和 Post 的接口
  entities: [User, Post],

  // 禁用 Mutation
  mutations: false,

  // 自定义命名
  typeNameMapper: (name) => {
    if (name === 'Person') {
      return { singular: 'person', plural: 'people' };
    }
    return undefined; // 其他实体使用默认
  },

  // 限制过滤深度为 1 层
  maxRelationDepth: 1,
});
```

---

## 📛 命名规则

默认使用 `pluralize` 库自动处理单复数：

| 实体       | 列表查询     | 单条查询   | 创建(单/批)                           | 更新             | 删除             |
| ---------- | ------------ | ---------- | ------------------------------------- | ---------------- | ---------------- |
| `User`     | `users`      | `user`     | `createUser` / `createUsers`          | `updateUser`     | `deleteUser`     |
| `Post`     | `posts`      | `post`     | `createPost` / `createPosts`          | `updatePost`     | `deletePost`     |
| `Category` | `categories` | `category` | `createCategory` / `createCategories` | `updateCategory` | `deleteCategory` |

可通过 `typeNameMapper` 覆盖命名：

```typescript
buildSchema(dataSource, {
  typeNameMapper: (name) => {
    if (name === 'Person') {
      return { singular: 'person', plural: 'people' };
    }
    return undefined; // 其他实体使用默认行为
  },
});
```

---

## 📁 项目结构

```text
src/
├── index.ts              # 入口，导出 buildSchema 及工具函数
├── buildSchema.ts        # 核心：组装类型定义和解析器
├── types.ts              # TypeScript 类型定义
├── builders/
│   ├── index.ts          # 构建器入口
│   ├── common.ts         # TypeORM → GraphQL 类型转换、过滤类型生成
│   ├── resolvers.ts      # 解析器生成（CRUD + 关联）
│   ├── names.ts          # 命名解析（单复数、驼峰）
│   └── types.ts          # 构建器内部类型
├── type-converter/
│   ├── index.ts          # TypeORM 类型 → GraphQL 类型映射
│   └── types.ts          # 类型转换相关类型
├── batch-loader/
│   └── index.ts          # N+1 批处理加载器
├── data-mappers/
│   └── index.ts          # 数据格式转换（Date、BigInt、JSON 等）
└── case-ops/
    └── index.ts          # 大小写转换工具
```

---

## 🔧 开发

```bash
# 安装依赖
pnpm install

# 开发模式（监听文件变化）
pnpm dev

# 构建
pnpm build

# 启动示例服务器
pnpm start

# 代码格式化
pnpm format

# Lint 检查
pnpm lint
```

---

## 🧪 示例服务器

项目内置了一个示例服务器，展示了完整的 CRUD 操作：

```bash
pnpm start
```

启动后可在浏览器中打开 GraphQL Playground 进行交互式查询。

---

## 📄 License

[MIT](LICENSE)

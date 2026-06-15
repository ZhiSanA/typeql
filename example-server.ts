import 'reflect-metadata';
import {
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { buildSchema } from './dist/index.js';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';

// ── Entities ──────────────────────────────

@Entity()
class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  email?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => Post, (post) => post.author)
  posts!: Post[];
}

@Entity()
class Post {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('text')
  title!: string;

  @Column('text', { nullable: true })
  content?: string;

  @ManyToOne(() => User, (user) => user.posts)
  @JoinColumn()
  author!: User;

  @Column('integer', { nullable: true })
  authorId?: number;
}

// ── DataSource ────────────────────────────

const dataSource = new DataSource({
  type: 'better-sqlite3',
  database: ':memory:',
  entities: [User, Post],
  synchronize: true,
  logging: false,
});

await dataSource.initialize();

// ── Seed data ─────────────────────────────

const userRepository = dataSource.getRepository(User);
const postRepository = dataSource.getRepository(Post);

const alice = await userRepository.save({
  name: 'Alice',
  email: 'alice@test.com',
});
const bob = await userRepository.save({ name: 'Bob', email: 'bob@test.com' });

await postRepository.save([
  { title: 'Hello World', content: 'First post!', author: alice },
  { title: 'GraphQL is cool', content: 'Second post!', author: alice },
  { title: 'TypeORM rocks', content: 'Third post!', author: bob },
  { title: 'TypeQL demo', author: bob },
]);

console.log(`Seeded ${2} users, ${4} posts`);

// ── Build Schema ──────────────────────────

const { schema, entities } = buildSchema(dataSource);

console.log('Queries:', Object.keys(entities.queries).join(', '));
console.log('Mutations:', Object.keys(entities.mutations).join(', '));

// ── Apollo Server ─────────────────────────

const server = new ApolloServer({ schema });

const { url } = await startStandaloneServer(server, {
  listen: { port: 8000 },
});

console.log(`\n🚀 Server ready at ${url}`);
console.log(`\nTry these queries in the browser or curl:\n`);
console.log(`# List users with posts`);
console.log(`curl '${url}?query={users{id,name,email,posts{id,title}}}'`);
console.log(`\n# Create a post`);
console.log(
  `curl -X POST '${url}' -H 'Content-Type: application/json' -d '{"query":"mutation{createPost(values:{title:\\"New Post\\",authorId:1}){id title}}"}'`,
);
console.log(`\n# Filter users by name`);
console.log(
  `curl '${url}?query={users(where:{name:{eq:\\"Alice\\"}}){id,name,email}}'`,
);

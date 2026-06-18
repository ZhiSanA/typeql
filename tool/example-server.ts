import 'reflect-metadata';
import {
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { buildSchema } from '../src';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';

// ═══════════════════════════════════════
// Model 1: Blog (User / Post)
// ═══════════════════════════════════════

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

// ═══════════════════════════════════════
// Model 2: School (Class / Student)
// ═══════════════════════════════════════

enum ClassLevel {
  PRIMARY = 'PRIMARY',
  JUNIOR_HIGH = 'JUNIOR_HIGH',
  HIGH = 'HIGH',
  UNIVERSITY = 'UNIVERSITY',
}

enum StudentSex {
  GIRL = 'GIRL',
  BOY = 'BOY',
}

@Entity({ name: 'classes' })
class Class {
  @PrimaryGeneratedColumn('increment')
  identity!: number;

  @Column({ type: 'uuid', generated: 'uuid', name: 'unique_identity' })
  uniqueIdentity!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column('simple-enum', { enum: ClassLevel, default: ClassLevel.PRIMARY })
  level!: ClassLevel;

  @OneToMany(() => Student, (student) => student.class)
  students!: Student[];
}

@Entity({ name: 'students' })
class Student {
  @PrimaryGeneratedColumn('increment')
  identity!: number;

  @Column({ type: 'uuid', generated: 'uuid', name: 'unique_identity' })
  uniqueIdentity!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column('text', { nullable: true })
  homeAddress?: string;

  @Column('simple-enum', { enum: StudentSex, default: StudentSex.GIRL })
  sex!: StudentSex;

  @Column('datetime', { nullable: true })
  bornAt?: Date;

  @Column('jsonb', { nullable: true })
  extra?: unknown;

  @Column('integer', { nullable: true })
  classIdentity?: number;

  @ManyToOne(() => Class, (classEntity) => classEntity.students)
  @JoinColumn()
  class!: Class;
}

// ═══════════════════════════════════════
// DataSource
// ═══════════════════════════════════════

const dataSource = new DataSource({
  type: 'better-sqlite3',
  database: ':memory:',
  entities: [User, Post, Class, Student],
  synchronize: true,
  logging: false,
});

await dataSource.initialize();

// ═══════════════════════════════════════
// Seed data — Blog
// ═══════════════════════════════════════

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

console.log(`✅ Blog: seeded 2 users, 4 posts`);

// ═══════════════════════════════════════
// Seed data — School
// ═══════════════════════════════════════

const classRepository = dataSource.getRepository(Class);
const studentRepository = dataSource.getRepository(Student);

const classA = await classRepository.save({
  name: 'Class A',
  description: 'First grade class',
  level: ClassLevel.PRIMARY,
});
const classB = await classRepository.save({
  name: 'Class B',
  level: ClassLevel.JUNIOR_HIGH,
});

await studentRepository.save([
  {
    name: 'Alice',
    sex: StudentSex.GIRL,
    class: classA,
    extra: { hobby: 'reading', age: 10 },
  },
  {
    name: 'Bob',
    sex: StudentSex.BOY,
    class: classA,
    extra: { hobby: 'sports', scores: [95, 87, 92] },
  },
  {
    name: 'Charlie',
    sex: StudentSex.BOY,
    class: classB,
    homeAddress: '123 Main St',
  },
]);

console.log(`✅ School: seeded 2 classes, 3 students`);

// ═══════════════════════════════════════
// Build Schema
// ═══════════════════════════════════════

const { schema, entities } = buildSchema(dataSource);

console.log('\n📋 Queries:', Object.keys(entities.queries).join(', '));
console.log('📋 Mutations:', Object.keys(entities.mutations).join(', '));

// ═══════════════════════════════════════
// Apollo Server
// ═══════════════════════════════════════

const server = new ApolloServer({ schema });

const { url } = await startStandaloneServer(server, {
  listen: { port: 1216 },
});

console.log(`\n🚀 Server ready at ${url}\n`);

// ── Blog query examples ──

console.log('── Blog queries ──\n');
console.log('# List users with posts');
console.log(`curl '${url}?query={users{id,name,email,posts{id,title}}}'`);
console.log(`\n# Filter users by name`);
console.log(
  `curl '${url}?query={users(where:{name:{eq:"Alice"}}){id,name,email}}'`,
);
console.log(`\n# Create a post`);
console.log(
  `curl -X POST '${url}' -H 'Content-Type: application/json' -H 'x-apollo-operation-name: blog' -d '{"query":"mutation{createPost(value:{title:\\"New Post\\",authorId:1}){id title}}"}'`,
);
console.log(`\n# Delete posts`);
console.log(
  `curl -X POST '${url}' -H 'Content-Type: application/json' -H 'x-apollo-operation-name: blog' -d '{"query":"mutation{deletePost(where:{id:{eq:1}}){affected}}"}'`,
);

// ── School query examples ──

console.log('\n── School queries ──\n');
console.log('# List classes with students');
console.log(
  `curl '${url}?query={classes{identity,name,level,students{identity,name,sex}}}'`,
);
console.log(`\n# Filter students by nested class level`);
console.log(
  `curl -X POST '${url}' -H 'Content-Type: application/json' -H 'x-apollo-operation-name: school' -d '{"query":"{students(where:{class:{level:{eq:\\"PRIMARY\\"}}}){identity,name,class{name,level}}}"}'`,
);
console.log(`\n# Create a student`);
console.log(
  `curl -X POST '${url}' -H 'Content-Type: application/json' -H 'x-apollo-operation-name: school' -d '{"query":"mutation{createStudent(value:{name:\\"Diana\\",sex:GIRL,classIdentity:1}){identity,name}}"}'`,
);
console.log(`\n# Query students with jsonb extra field`);
console.log(
  `curl -X POST '${url}' -H 'Content-Type: application/json' -H 'x-apollo-operation-name: school' -d '{"query":"{students{identity,name,extra}}"}'`,
);

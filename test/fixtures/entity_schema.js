const { EntitySchema } = require('typeorm');

const TeamSchema = new EntitySchema({
  name: 'Team',
  tableName: 'teams',
  columns: {
    id: { type: Number, primary: true, generated: true },
    name: { type: 'varchar', length: 80, unique: true },
  },
});

const UserSchema = new EntitySchema({
  name: 'User',
  columns: {
    id: { primary: true, type: 'uuid', generated: 'uuid' },
    email: { type: String, unique: true },
    bio: { type: 'text', nullable: true },
    createdAt: { type: Date, createDate: true },
  },
  relations: {
    team: { type: 'many-to-one', target: 'Team', joinColumn: { name: 'team_id' }, nullable: false },
    posts: { type: 'one-to-many', target: 'Post', inverseSide: 'author' },
    tags: { type: 'many-to-many', target: 'Tag', joinTable: true },
  },
});

const TagSchema = new EntitySchema({
  name: 'Tag',
  columns: { id: { type: Number, primary: true, generated: true }, label: { type: String } },
});

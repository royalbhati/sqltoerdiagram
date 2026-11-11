import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, OneToOne, JoinColumn, ManyToMany, JoinTable, CreateDateColumn } from 'typeorm';

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 80, unique: true })
  name: string;

  @OneToMany(() => User, (user) => user.team)
  members: User[];
}

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column('text', { nullable: true })
  bio?: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number;

  @CreateDateColumn()
  createdAt: Date;

  // relation with an explicit join column
  @ManyToOne(() => Team, (team) => team.members, { nullable: false })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @OneToOne(() => Profile)
  @JoinColumn()
  profile: Profile;

  @ManyToMany(() => Tag)
  @JoinTable()
  tags: Tag[];
}

@Entity()
export class Profile {
  @PrimaryGeneratedColumn() id: number;
  @Column() avatarUrl: string;
}

@Entity()
export class Tag {
  @PrimaryGeneratedColumn() id: number;
  @Column() label: string;
}

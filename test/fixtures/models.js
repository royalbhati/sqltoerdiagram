const { DataTypes } = require('sequelize');
const Team = sequelize.define('Team', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
});
const Player = sequelize.define('Player', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  teamId: { type: DataTypes.INTEGER, references: { model: 'Teams', key: 'id' } },
  nickname: DataTypes.STRING,
});

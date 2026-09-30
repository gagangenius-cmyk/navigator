import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmSourceAttributes {
  id: number;
  name: string;
  status: number;
  category: string | null;
  sub_source: number;
}

interface CrmSourceCreationAttributes extends Optional<CrmSourceAttributes, 'id' | 'status' | 'category' | 'sub_source'> {}

class CrmSource extends Model<CrmSourceAttributes, CrmSourceCreationAttributes> implements CrmSourceAttributes {
  declare id: number;
  declare name: string;
  declare status: number;
  declare category: string | null;
  declare sub_source: number;

  public static associate(models: any) {
  }
}

CrmSource.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(555),
      allowNull: false,
      unique: true
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    category: {
      type: DataTypes.STRING(60),
      allowNull: true
    },
    sub_source: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
  },
  {
    sequelize,
    modelName: 'CrmSource',
    tableName: 'crm_source',
    timestamps: false,
    freezeTableName: true,
  });

export { CrmSource };
export type { CrmSourceAttributes, CrmSourceCreationAttributes };

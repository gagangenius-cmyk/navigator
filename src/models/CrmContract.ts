import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmContractAttributes {
  id: number;
  leadId: number;
  opportunityId: number;
  contractNumber: string;
  branchId: number;
  regionId: number | null;
  countryInterest: number | null;
  serviceId: number | null;
  programTypeId: number | null;
  contractType: string;
  currency: string;
  exchangeRateToAed: number;
  payTotal: number;
  discount: number;
  paidYet: number;
  payBalance: number;
  payType: string | null;
  demandAmt: number;
  dueDate: Date | null;
  demdRemark: string | null;
  feeAgreeDate: Date | null;
  agreeDate: Date | null;
  renDate: Date | null;
  renExpiryDate: Date | null;
  renewType: string | null;
  novat: number;
  advanced: number;
  status: 'draft' | 'active' | 'completed' | 'cancelled' | 'on_hold';
  statusDate: Date;
  isDeleted: boolean;
  deletedAt: Date | null;
  counselorId: number | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmContractCreationAttributes extends Optional<CrmContractAttributes, 'id' | 'regionId' | 'countryInterest' | 'serviceId' | 'programTypeId' | 'contractType' | 'currency' | 'exchangeRateToAed' | 'discount' | 'paidYet' | 'payBalance' | 'payType' | 'demandAmt' | 'dueDate' | 'demdRemark' | 'feeAgreeDate' | 'agreeDate' | 'renDate' | 'renExpiryDate' | 'renewType' | 'novat' | 'advanced' | 'status' | 'statusDate' | 'isDeleted' | 'deletedAt' | 'counselorId' | 'createdAt' | 'updatedAt'> {}

class CrmContract extends Model<CrmContractAttributes, CrmContractCreationAttributes> implements CrmContractAttributes {
  declare id: number;
  declare leadId: number;
  declare opportunityId: number;
  declare contractNumber: string;
  declare branchId: number;
  declare regionId: number | null;
  declare countryInterest: number | null;
  declare serviceId: number | null;
  declare programTypeId: number | null;
  declare contractType: string;
  declare currency: string;
  declare exchangeRateToAed: number;
  declare payTotal: number;
  declare discount: number;
  declare paidYet: number;
  declare payBalance: number;
  declare payType: string | null;
  declare demandAmt: number;
  declare dueDate: Date | null;
  declare demdRemark: string | null;
  declare feeAgreeDate: Date | null;
  declare agreeDate: Date | null;
  declare renDate: Date | null;
  declare renExpiryDate: Date | null;
  declare renewType: string | null;
  declare novat: number;
  declare advanced: number;
  declare status: 'draft' | 'active' | 'completed' | 'cancelled' | 'on_hold';
  declare statusDate: Date;
  declare isDeleted: boolean;
  declare deletedAt: Date | null;
  declare counselorId: number | null;
  declare createdBy: number;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmContract.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
    CrmContract.belongsTo(models.CrmcOpportunities, { foreignKey: 'opportunity_id', targetKey: 'id', as: 'sourceOpportunity' });
    CrmContract.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmContract.belongsTo(models.CrmRegion, { foreignKey: 'region_id', targetKey: 'id', as: 'dmRegion' });
    CrmContract.belongsTo(models.CrmService, { foreignKey: 'service_id', targetKey: 'id', as: 'dmService' });
    CrmContract.belongsTo(models.CrmProgramType, { foreignKey: 'program_type_id', targetKey: 'id', as: 'dmProgramType' });
    CrmContract.belongsTo(models.CrmEmployee, { foreignKey: 'counselor_id', targetKey: 'id', as: 'counselor' });
    CrmContract.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
    CrmContract.hasMany(models.CrmContractAgreement, { foreignKey: 'contract_id', sourceKey: 'id', as: 'agreements' });
    CrmContract.hasMany(models.CrmContractReceipt, { foreignKey: 'contract_id', sourceKey: 'id', as: 'receipts' });
    CrmContract.hasMany(models.CrmContractPaymentSchedule, { foreignKey: 'contract_id', sourceKey: 'id', as: 'paymentSchedule' });
  }
}

CrmContract.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    leadId: { type: DataTypes.INTEGER, allowNull: false, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    opportunityId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'opportunity_id', references: { model: 'crm_opportunities', key: 'id' } },
    contractNumber: { type: DataTypes.STRING(50), allowNull: false, unique: true, field: 'contract_number' },
    branchId: { type: DataTypes.INTEGER, allowNull: false, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    regionId: { type: DataTypes.INTEGER, allowNull: true, field: 'region_id', references: { model: 'crm_region', key: 'id' } },
    countryInterest: { type: DataTypes.INTEGER, allowNull: true, field: 'country_interest' },
    serviceId: { type: DataTypes.INTEGER, allowNull: true, field: 'service_id', references: { model: 'crm_service', key: 'id' } },
    programTypeId: { type: DataTypes.INTEGER, allowNull: true, field: 'program_type_id', references: { model: 'crm_program_type', key: 'id' } },
    contractType: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'individual', field: 'contract_type' },
    currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'AED', field: 'currency' },
    exchangeRateToAed: { type: DataTypes.DECIMAL(12, 6), allowNull: false, defaultValue: 1, field: 'exchange_rate_to_aed' },
    payTotal: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'pay_total' },
    discount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'discount' },
    paidYet: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'paid_yet' },
    payBalance: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'pay_balance' },
    payType: { type: DataTypes.STRING(55), allowNull: true, field: 'pay_type' },
    demandAmt: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'demand_amt' },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'due_date' },
    demdRemark: { type: DataTypes.TEXT, allowNull: true, field: 'demd_remark' },
    feeAgreeDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'fee_agree_date' },
    agreeDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'agree_date' },
    renDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'ren_date' },
    renExpiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'ren_expiry_date' },
    renewType: { type: DataTypes.STRING(50), allowNull: true, field: 'renew_type' },
    novat: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'novat' },
    advanced: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'advanced' },
    status: { type: DataTypes.ENUM('draft', 'active', 'completed', 'cancelled', 'on_hold'), allowNull: false, defaultValue: 'draft', field: 'status' },
    statusDate: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW, field: 'status_date' },
    isDeleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_deleted' },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: 'deleted_at' },
    counselorId: { type: DataTypes.INTEGER, allowNull: true, field: 'counselor_id', references: { model: 'crm_employee', key: 'id' } },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmContract',
    tableName: 'crm_contracts',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmContract };
export type { CrmContractAttributes, CrmContractCreationAttributes };

import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmContractAgreementAttributes {
  id: number;
  contractId: number;
  agreementNumber: string;
  agreementType: string;
  templateId: number | null;
  agreementTitle: string | null;
  title: string | null;
  description: string | null;
  duration: string | null;
  startDate: Date;
  endDate: Date;
  amount: number;
  totalAmount: number | null;
  currency: string;
  terms: string | null;
  termsAndConditions: string | null;
  specialConditions: string | null;
  content: string | null;
  status: 'draft' | 'generated' | 'sent' | 'signed' | 'uploaded' | 'expired';
  generatedDate: Date;
  sentDate: Date | null;
  signedDate: Date | null;
  clientSignature: string | null;
  signatureDate: Date | null;
  documentUrl: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  companyName: string | null;
  companyAddress: string | null;
  uploadedToCrm: boolean;
  uploadedBy: number | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmContractAgreementCreationAttributes extends Optional<CrmContractAgreementAttributes, 'id' | 'templateId' | 'agreementTitle' | 'title' | 'description' | 'duration' | 'totalAmount' | 'currency' | 'terms' | 'termsAndConditions' | 'specialConditions' | 'content' | 'status' | 'generatedDate' | 'sentDate' | 'signedDate' | 'clientSignature' | 'signatureDate' | 'documentUrl' | 'clientName' | 'clientEmail' | 'clientPhone' | 'companyName' | 'companyAddress' | 'uploadedToCrm' | 'uploadedBy' | 'createdAt' | 'updatedAt'> {}

class CrmContractAgreement extends Model<CrmContractAgreementAttributes, CrmContractAgreementCreationAttributes> implements CrmContractAgreementAttributes {
  declare id: number;
  declare contractId: number;
  declare agreementNumber: string;
  declare agreementType: string;
  declare templateId: number | null;
  declare agreementTitle: string | null;
  declare title: string | null;
  declare description: string | null;
  declare duration: string | null;
  declare startDate: Date;
  declare endDate: Date;
  declare amount: number;
  declare totalAmount: number | null;
  declare currency: string;
  declare terms: string | null;
  declare termsAndConditions: string | null;
  declare specialConditions: string | null;
  declare content: string | null;
  declare status: 'draft' | 'generated' | 'sent' | 'signed' | 'uploaded' | 'expired';
  declare generatedDate: Date;
  declare sentDate: Date | null;
  declare signedDate: Date | null;
  declare clientSignature: string | null;
  declare signatureDate: Date | null;
  declare documentUrl: string | null;
  declare clientName: string | null;
  declare clientEmail: string | null;
  declare clientPhone: string | null;
  declare companyName: string | null;
  declare companyAddress: string | null;
  declare uploadedToCrm: boolean;
  declare uploadedBy: number | null;
  declare createdBy: number;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmContractAgreement.belongsTo(models.CrmContract, { foreignKey: 'contract_id', targetKey: 'id', as: 'contract' });
    CrmContractAgreement.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
    CrmContractAgreement.belongsTo(models.CrmEmployee, { foreignKey: 'uploaded_by', targetKey: 'id', as: 'uploadedEmployee' });
  }
}

CrmContractAgreement.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    contractId: { type: DataTypes.INTEGER, allowNull: false, field: 'contract_id', references: { model: 'crm_contracts', key: 'id' } },
    agreementNumber: { type: DataTypes.STRING(50), allowNull: false, unique: true, field: 'agreement_number' },
    agreementType: { type: DataTypes.STRING(100), allowNull: false, field: 'agreement_type' },
    templateId: { type: DataTypes.INTEGER, allowNull: true, field: 'template_id' },
    agreementTitle: { type: DataTypes.STRING(255), allowNull: true, field: 'agreement_title' },
    title: { type: DataTypes.STRING(255), allowNull: true, field: 'title' },
    description: { type: DataTypes.TEXT, allowNull: true, field: 'description' },
    duration: { type: DataTypes.STRING(50), allowNull: true, field: 'duration' },
    startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'start_date' },
    endDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'end_date' },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'amount' },
    totalAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true, field: 'total_amount' },
    currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'AED', field: 'currency' },
    terms: { type: DataTypes.TEXT, allowNull: true, field: 'terms' },
    termsAndConditions: { type: DataTypes.TEXT, allowNull: true, field: 'terms_and_conditions' },
    specialConditions: { type: DataTypes.TEXT, allowNull: true, field: 'special_conditions' },
    content: { type: DataTypes.TEXT('long'), allowNull: true, field: 'content' },
    status: { type: DataTypes.ENUM('draft', 'generated', 'sent', 'signed', 'uploaded', 'expired'), allowNull: false, defaultValue: 'draft', field: 'status' },
    generatedDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'generated_date' },
    sentDate: { type: DataTypes.DATE, allowNull: true, field: 'sent_date' },
    signedDate: { type: DataTypes.DATE, allowNull: true, field: 'signed_date' },
    clientSignature: { type: DataTypes.TEXT, allowNull: true, field: 'client_signature' },
    signatureDate: { type: DataTypes.DATE, allowNull: true, field: 'signature_date' },
    documentUrl: { type: DataTypes.STRING(500), allowNull: true, field: 'document_url' },
    clientName: { type: DataTypes.STRING(255), allowNull: true, field: 'client_name' },
    clientEmail: { type: DataTypes.STRING(255), allowNull: true, field: 'client_email' },
    clientPhone: { type: DataTypes.STRING(80), allowNull: true, field: 'client_phone' },
    companyName: { type: DataTypes.STRING(255), allowNull: true, field: 'company_name' },
    companyAddress: { type: DataTypes.TEXT, allowNull: true, field: 'company_address' },
    uploadedToCrm: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'uploaded_to_crm' },
    uploadedBy: { type: DataTypes.INTEGER, allowNull: true, field: 'uploaded_by', references: { model: 'crm_employee', key: 'id' } },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmContractAgreement',
    tableName: 'crm_contract_agreements',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmContractAgreement };
export type { CrmContractAgreementAttributes, CrmContractAgreementCreationAttributes };

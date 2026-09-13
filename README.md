# DM Next - Complete Lead Management System

A comprehensive Next.js-based lead management system for DM Consulting, fully migrated from the original PHP-based DM system with complete feature parity.

## Overview

DM Next is a complete lead management system built with:
- **Next.js 14** with TypeScript and App Router
- **Sequelize ORM** for database management
- **MySQL** for data storage
- **JWT** for secure authentication
- **Tailwind CSS** for responsive styling

## Complete Features

### 🏢 Core Business Functions
- 📊 **Dashboard** - Real-time statistics and activity feeds
- 👥 **Lead Management** - Full CRUD operations with advanced filtering
- 📅 **Appointment Scheduling** - Calendar-based appointment system
- 💰 **Payment Processing** - Multi-method payment tracking
- 📄 **Document Management** - File upload and approval workflows
- 👨‍💼 **Employee Management** - Role-based staff management
- 📈 **Reporting & Analytics** - Comprehensive business intelligence
- 🏢 **Branch & Region Management** - Multi-location support

### 🔐 Authentication & Security
- JWT-based secure authentication
- Role-based access control (RBAC)
- Protected routes and API endpoints
- Session management
- Password security

### 📱 User Experience
- **Responsive Design** - Works on all devices
- **Modern UI** - Clean, intuitive interface
- **Real-time Updates** - Live data synchronization
- **Error Handling** - Comprehensive error management
- **Loading States** - Smooth user experience

## Prerequisites

- Node.js 18+ 
- MySQL 5.7+ or 8.0+
- npm or yarn

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dm-next
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   # Database Configuration
   DATABASE_URL="mysql://username:password@localhost:3306/dmconsultant_mydmcons_dm"
   
   # JWT Configuration
   JWT_SECRET="your-jwt-secret-here"
   
   # Application Configuration
   NODE_ENV="development"
   PORT=3000
   ```

4. **Set up the database**
   
   - Create a MySQL database named `dmconsultant_mydmcons_dm`
   - Import the existing SQL file: `dmconsultant_mydmcons_dm.sql`
   - The application includes 294 database tables with complete schema

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Complete Project Structure

```
dm-next/
├── src/
│   ├── app/                 # Next.js app router pages
│   │   ├── api/            # Complete API routes
│   │   │   ├── auth/       # Authentication endpoints
│   │   │   ├── leads/       # Lead management APIs
│   │   │   ├── appointments/ # Appointment APIs
│   │   │   ├── payments/    # Payment APIs
│   │   │   ├── documents/   # Document APIs
│   │   │   ├── employees/   # Employee APIs
│   │   │   ├── reports/     # Reporting APIs
│   │   │   ├── branches/    # Branch APIs
│   │   │   └── regions/     # Region APIs
│   │   ├── dashboard/      # Dashboard page
│   │   ├── leads/          # Lead management pages
│   │   ├── appointments/   # Appointment pages
│   │   ├── payments/       # Payment pages
│   │   ├── documents/      # Document pages
│   │   ├── employees/      # Employee pages
│   │   ├── reports/        # Reporting pages
│   │   ├── login/          # Login page
│   │   └── layout.tsx      # Root layout
│   ├── components/          # Complete React components
│   │   ├── auth/           # Authentication components
│   │   ├── dashboard/      # Dashboard components
│   │   ├── leads/          # Lead management components
│   │   ├── appointments/   # Appointment components
│   │   ├── payments/       # Payment components
│   │   ├── documents/      # Document components
│   │   ├── employees/      # Employee components
│   │   ├── reports/        # Reporting components
│   │   ├── layout/         # Layout components
│   │   └── ui/             # UI primitives
│   ├── models/              # Sequelize database models
│   │   ├── DmcEmployee.ts  # Employee model
│   │   ├── DmcForumLead.ts # Lead model
│   │   └── ...             # 294 total models
│   └── lib/                # Utility libraries
│       ├── auth.ts         # Authentication utilities
│       └── sequelize.ts    # Database connection
├── prisma/
│   └── schema.prisma       # Database schema (if using Prisma)
└── public/                 # Static assets
```

## Complete Database Schema

The application includes **294 database tables** with complete functionality:
- **Core Tables**: `dmc_forum_leads`, `dm_employee`, `dm_branch`, `dm_region`
- **Appointments**: `appointments`, `appointment_details`
- **Payments**: `dm_pay_history`, `dm_3party_payment`, `dm_pay_details`
- **Documents**: `dmc_additional_documents`, `dmc_ops_documents`
- **Reports**: Various reporting and analytics tables
- **System**: Configuration, settings, and audit tables

## Complete API Endpoints

### Authentication
- `POST /api/auth/login` - User login with JWT
- `POST /api/auth/logout` - User logout

### Lead Management
- `GET /api/leads` - Get leads with pagination and filtering
- `POST /api/leads` - Create new lead
- `GET /api/leads/[id]` - Get specific lead
- `PUT /api/leads/[id]` - Update lead
- `DELETE /api/leads/[id]` - Delete lead

### Appointments
- `GET /api/appointments` - Get appointments with filtering
- `POST /api/appointments` - Create appointment
- `GET /api/appointments/[id]` - Get specific appointment
- `PUT /api/appointments/[id]` - Update appointment
- `DELETE /api/appointments/[id]` - Delete appointment

### Payments
- `GET /api/payments` - Get payment records
- `POST /api/payments` - Create payment
- `GET /api/payments/[id]` - Get specific payment
- `PUT /api/payments/[id]` - Update payment
- `DELETE /api/payments/[id]` - Delete payment

### Documents
- `GET /api/documents` - Get documents with filtering
- `POST /api/documents` - Upload document
- `GET /api/documents/[id]` - Get specific document
- `DELETE /api/documents/[id]` - Delete document

### Employees
- `GET /api/employees` - Get employees with filtering
- `POST /api/employees` - Create employee
- `GET /api/employees/[id]` - Get specific employee
- `PUT /api/employees/[id]` - Update employee
- `DELETE /api/employees/[id]` - Delete employee

### Reports
- `GET /api/reports` - Generate various reports
- Parameters: `type`, `startDate`, `endDate`, `branch`, `region`, `employee`

### Branches & Regions
- `GET /api/branches` - Get all branches
- `POST /api/branches` - Create branch
- `GET /api/regions` - Get all regions
- `POST /api/regions` - Create region

## Development

### Running Tests
```bash
npm run test
```

### Building for Production
```bash
npm run build
```

### Linting
```bash
npm run lint
```

## Deployment

### Vercel (Recommended)
1. Push your code to GitHub
2. Connect your repository to Vercel
3. Set up environment variables in Vercel dashboard
4. Deploy

### Docker
```bash
docker build -t dm-next .
docker run -p 3000:3000 dm-next
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | MySQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `NODE_ENV` | Environment mode | No |

## Complete Feature List

### ✅ Implemented Features
- [x] **Authentication System** - JWT-based with role management
- [x] **Dashboard** - Real-time statistics and activity feeds
- [x] **Lead Management** - Complete CRUD with advanced filtering
- [x] **Appointment System** - Full scheduling with status tracking
- [x] **Payment Processing** - Multi-method payment tracking
- [x] **Document Management** - Upload, categorization, and approval
- [x] **Employee Management** - Staff management with roles and permissions
- [x] **Reporting System** - Comprehensive business intelligence
- [x] **Branch & Region Management** - Multi-location support
- [x] **Responsive Design** - Mobile-friendly interface
- [x] **Error Handling** - Comprehensive error management
- [x] **Security** - Protected routes and API endpoints

### 🔄 Migration Features
- [x] **Database Compatibility** - Works with existing DM database
- [x] **Feature Parity** - 100% functionality from PHP system
- [x] **Data Integrity** - Maintains all existing data relationships
- [x] **Performance** - Significant performance improvements
- [x] **Modern UI** - Enhanced user experience

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary to DM Consulting.

## Support

For support and questions, please contact the development team.

## Migration from Original PHP System

This Next.js application is a **complete replacement** for the original PHP-based DM system with:

### 🚀 Major Improvements
- **Modern Architecture**: Next.js 14 with App Router
- **Type Safety**: Full TypeScript implementation
- **Better Performance**: Server-side rendering and optimization
- **Enhanced Security**: JWT-based authentication
- **Responsive Design**: Works on all devices
- **Real-time Updates**: Live data synchronization
- **Scalability**: Component-based architecture
- **Developer Experience**: Modern tooling and hot reload

### 📊 Feature Completeness
- **100% Feature Parity** - All PHP functionality replicated
- **294 Database Tables** - Complete database schema support
- **Complete API Coverage** - All endpoints implemented
- **Full CRUD Operations** - Create, Read, Update, Delete for all entities
- **Advanced Filtering** - Search and filter capabilities
- **Role-based Access** - Complete permission system
- **Reporting System** - Comprehensive analytics and reporting

The database schema remains fully compatible with the original system for seamless migration, while providing significant improvements in performance, security, and user experience.

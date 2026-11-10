CREATE TABLE [dbo].[Departments] (
    [DepartmentId] INT IDENTITY(1,1) NOT NULL,
    [Name] NVARCHAR(100) NOT NULL,
    CONSTRAINT [PK_Departments] PRIMARY KEY CLUSTERED ([DepartmentId] ASC)
);
GO
CREATE TABLE [dbo].[Employees] (
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    [DepartmentId] INT NOT NULL,
    [ManagerId] UNIQUEIDENTIFIER NULL,
    [Salary] DECIMAL(18, 2) NULL,
    [HiredOn] DATETIME2(7) NOT NULL,
    CONSTRAINT [PK_Employees] PRIMARY KEY ([EmployeeId]),
    CONSTRAINT [FK_Employees_Departments] FOREIGN KEY ([DepartmentId]) REFERENCES [dbo].[Departments] ([DepartmentId]),
    CONSTRAINT [FK_Employees_Manager] FOREIGN KEY ([ManagerId]) REFERENCES [dbo].[Employees] ([EmployeeId])
);
GO

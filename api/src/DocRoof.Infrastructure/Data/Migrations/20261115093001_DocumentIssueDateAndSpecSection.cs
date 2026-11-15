using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DocRoof.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class DocumentIssueDateAndSpecSection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "IssueDate",
                table: "Documents",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SpecSection",
                table: "Documents",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IssueDate",
                table: "Documents");

            migrationBuilder.DropColumn(
                name: "SpecSection",
                table: "Documents");
        }
    }
}

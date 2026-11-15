using DocRoof.Infrastructure.Common;
using DocRoof.Infrastructure.Data;
using DocRoof.Infrastructure.Files;
using DocRoof.Infrastructure.Seeding;
using DocRoof.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DocRoof.Infrastructure;

public sealed class DatabaseOptions
{
    public const string Section = "Database";

    /// <summary>Apply EF Core migrations at startup (enable for containers; keep off when a DBA runs migrations).</summary>
    public bool MigrateOnStartup { get; set; }

    /// <summary>Create the persistent sample workspace (login demo accounts) if it does not exist.</summary>
    public bool SeedSampleTenant { get; set; }

    /// <summary>Password for the sample workspace accounts. Intentionally public demo value in development only.</summary>
    public string? SampleUserPassword { get; set; }
}

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var connectionString = config.GetConnectionString("DocRoof")
                               ?? throw new InvalidOperationException("Connection string 'DocRoof' is not configured.");

        services.AddSingleton(TimeProvider.System);
        // All registered interceptors apply (tests can add fault-injection interceptors).
        services.AddSingleton<IInterceptor, ImmutabilityInterceptor>();
        services.AddDbContext<DocRoofDbContext>((sp, o) => o
            .UseSqlServer(connectionString, sql => sql.CommandTimeout(60))
            .AddInterceptors(sp.GetServices<IInterceptor>()));

        services.Configure<StorageOptions>(config.GetSection(StorageOptions.Section));
        services.Configure<DemoOptions>(config.GetSection(DemoOptions.Section));
        services.Configure<DatabaseOptions>(config.GetSection(DatabaseOptions.Section));

        var mode = config[$"{StorageOptions.Section}:Mode"] ?? "Local";
        if (string.Equals(mode, "Database", StringComparison.OrdinalIgnoreCase))
        {
            services.AddScoped<IFileStorage, DatabaseFileStorage>();
        }
        else
        {
            services.AddSingleton<IFileStorage, LocalDiskFileStorage>();
        }

        services.AddIdentityCore<AppUser>(o =>
            {
                o.Password.RequiredLength = 10;
                o.Password.RequireNonAlphanumeric = false;
                o.Lockout.MaxFailedAccessAttempts = 5;
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                o.Lockout.AllowedForNewUsers = true;
                o.User.RequireUniqueEmail = false;
            })
            .AddEntityFrameworkStores<DocRoofDbContext>()
            .AddSignInManager()
            .AddClaimsPrincipalFactory<AppClaimsPrincipalFactory>()
            .AddDefaultTokenProviders();

        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();
        services.AddScoped<IProjectAccessService, ProjectAccessService>();
        services.AddScoped<AuditWriter>();
        services.AddScoped<UserDirectory>();
        services.AddScoped<TenantSeeder>();
        services.AddScoped<TenantPurger>();
        services.AddScoped<DemoService>();
        services.AddScoped<ProjectService>();
        services.AddScoped<DocumentService>();
        services.AddScoped<Notifier>();
        services.AddScoped<RfiService>();
        services.AddScoped<SubmittalService>();
        services.AddScoped<CommentService>();
        services.AddScoped<AuditService>();
        services.AddScoped<ReviewQueueService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<InsightsService>();
        services.Configure<DocRoof.Infrastructure.Extraction.ExtractionOptions>(config.GetSection(DocRoof.Infrastructure.Extraction.ExtractionOptions.Section));
        services.AddHttpClient<DocRoof.Infrastructure.Extraction.LanguageModelExtractionEngine>();
        services.AddScoped<DocRoof.Infrastructure.Extraction.ExtractionService>();
        services.Configure<ReminderOptions>(config.GetSection(ReminderOptions.Section));
        services.AddSingleton<OverdueReminderService>();
        services.AddHostedService(sp => sp.GetRequiredService<OverdueReminderService>());

        services.AddHostedService<DatabaseInitializer>();
        services.AddSingleton<GuestCleanupService>();
        services.AddHostedService(sp => sp.GetRequiredService<GuestCleanupService>());
        return services;
    }
}

/// <summary>Runs migrations and idempotent seeding at startup when enabled by configuration.</summary>
public sealed class DatabaseInitializer(IServiceScopeFactory scopes, IOptions<DatabaseOptions> options, ILogger<DatabaseInitializer> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var opt = options.Value;
        if (!opt.MigrateOnStartup && !opt.SeedSampleTenant)
        {
            return;
        }

        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DocRoofDbContext>();
        if (opt.MigrateOnStartup)
        {
            logger.LogInformation("Applying database migrations");
            await db.Database.MigrateAsync(cancellationToken);
        }

        if (opt.SeedSampleTenant)
        {
            var seeder = scope.ServiceProvider.GetRequiredService<TenantSeeder>();
            await seeder.EnsureSampleTenantAsync(opt.SampleUserPassword, cancellationToken);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

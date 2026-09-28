using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Partyline.Infrastructure;

/// <summary>
/// Registers Partyline transformation after plugin startup.
/// </summary>
public class PartylineWebInjectionStartupService : IHostedService
{
    private static readonly Guid TransformationId = Guid.Parse("bab2fa5a-1bdc-4e73-b915-9ca549373b86");
    private readonly ILogger<PartylineWebInjectionStartupService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="PartylineWebInjectionStartupService"/> class.
    /// </summary>
    /// <param name="logger">Logger instance.</param>
    public PartylineWebInjectionStartupService(ILogger<PartylineWebInjectionStartupService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        RegisterTransformation();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }

    private void RegisterTransformation()
    {
        try
        {
            Assembly? fileTransformationAssembly = AssemblyLoadContext.All
                .SelectMany(loadContext => loadContext.Assemblies)
                .FirstOrDefault(assembly => assembly.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);

            if (fileTransformationAssembly is null)
            {
                _logger.LogWarning("File Transformation assembly not found; partyline.js will not be injected.");
                return;
            }

            Type? pluginInterfaceType = fileTransformationAssembly.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
            MethodInfo? registerTransformationMethod = pluginInterfaceType?.GetMethod("RegisterTransformation", BindingFlags.Public | BindingFlags.Static);

            if (registerTransformationMethod is null)
            {
                _logger.LogWarning("File Transformation RegisterTransformation API not found.");
                return;
            }

            string payloadJson = "{" +
                $"\"id\":\"{TransformationId}\"," +
                "\"fileNamePattern\":\"index.html\"," +
                $"\"callbackAssembly\":\"{typeof(PartylineWebTransformer).Assembly.FullName}\"," +
                $"\"callbackClass\":\"{typeof(PartylineWebTransformer).FullName}\"," +
                "\"callbackMethod\":\"TransformIndexHtml\"" +
                "}";

            Type? payloadType = registerTransformationMethod.GetParameters().FirstOrDefault()?.ParameterType;
            object? payload;

            if (payloadType?.Name == "String")
            {
                payload = payloadJson;
            }
            else
            {
                MethodInfo? parseMethod = payloadType?.GetMethod("Parse", [typeof(string)]);
                if (parseMethod is null)
                {
                    _logger.LogWarning("Unable to resolve JSON payload parser for File Transformation API.");
                    return;
                }

                payload = parseMethod.Invoke(null, [payloadJson]);
                if (payload is null)
                {
                    _logger.LogWarning("Failed to parse File Transformation payload.");
                    return;
                }
            }

            registerTransformationMethod.Invoke(null, [payload]);
            _logger.LogInformation("Registered File Transformation for partyline.js injection.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to register partyline.js transformation.");
        }
    }
}

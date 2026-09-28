using System;
using Jellyfin.Plugin.Partyline.Api;
using Jellyfin.Plugin.Partyline.Voice;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Jellyfin.Plugin.Partyline.Infrastructure;

/// <summary>
/// Registers Partyline web transformations.
/// </summary>
public class PartylineWebInjectionRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<ChatHistoryStore>();
        serviceCollection.AddSingleton<VoiceRoomManager>();
        serviceCollection.AddSingleton<TurnCredentialService>();
        serviceCollection.AddHostedService<PartylineWebInjectionStartupService>();
    }
}

using System;
using System.Globalization;
using System.IO;

namespace Jellyfin.Plugin.Partyline.Infrastructure;

/// <summary>
/// Applies web content transformations for Partyline.
/// </summary>
public static class PartylineWebTransformer
{
    private const string PartylineScriptMarker = "<!-- Partyline partyline.js -->";

    /// <summary>
    /// Injects Partyline script into jellyfin-web index page.
    /// </summary>
    /// <param name="payload">The transformation payload.</param>
    /// <returns>The transformed index.html content.</returns>
    public static string TransformIndexHtml(WebContentTransformPayload payload)
    {
        if (payload.Contents.Contains(PartylineScriptMarker, StringComparison.Ordinal))
        {
            return payload.Contents;
        }

        string scriptContent = GetEmbeddedScript("partyline.js") + GetEmbeddedScript("voice-chat.js");
        if (string.IsNullOrEmpty(scriptContent))
        {
            return payload.Contents;
        }

        string injectedScript = string.Format(CultureInfo.InvariantCulture, "{0}<script>{1}</script>", PartylineScriptMarker, scriptContent);

        return payload.Contents.Replace("</body>", string.Format(CultureInfo.InvariantCulture, "{0}</body>", injectedScript), StringComparison.Ordinal);
    }

    /// <summary>
    /// Returns embedded partyline.js content for plugin web path.
    /// </summary>
    /// <returns>Script content.</returns>
    public static string GetPartylineScript()
    {
        return GetEmbeddedScript("partyline.js");
    }

    private static string GetEmbeddedScript(string fileName)
    {
        string resourcePath = "Jellyfin.Plugin.Partyline.Web." + fileName;
        using Stream? stream = typeof(PartylineWebTransformer).Assembly.GetManifestResourceStream(resourcePath);
        if (stream is null)
        {
            return string.Empty;
        }

        using StreamReader reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}

using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;

namespace OnuStudio.App.Controls;

/// <summary>Convierte el "tono" de un estado (ok, warn, error…) en color.</summary>
public sealed class ToneToBrushConverter : IValueConverter
{
    public bool Soft { get; set; }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var tone = value?.ToString() ?? "muted";
        return (tone, Soft) switch
        {
            ("ok", false) => Brush("#13875A"),
            ("ok", true) => Brush("#E7F7EF"),
            ("warn", false) => Brush("#B36B12"),
            ("warn", true) => Brush("#FFF5E6"),
            ("error", false) => Brush("#B42318"),
            ("error", true) => Brush("#FFF0EF"),
            ("info", false) => Brush("#1267DD"),
            ("info", true) => Brush("#EAF2FD"),
            (_, false) => Brush("#5C6F82"),
            _ => Brush("#EDF1F5"),
        };
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();

    private static SolidColorBrush Brush(string hex) =>
        new((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex)!);
}

/// <summary>Muestra un elemento solo cuando el texto tiene contenido.</summary>
public sealed class TextToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        string.IsNullOrWhiteSpace(value?.ToString()) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Visible solo cuando el valor es igual al parametro (la tarjeta actual del paso).</summary>
public sealed class ShowWhenConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        string.Equals(value?.ToString(), parameter?.ToString(), StringComparison.Ordinal) ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Invierte un bool, para enlazar "la ultima seccion" y cosas parecidas.</summary>
public sealed class NotConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not true;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not true;
}

public sealed class InverseBoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

public sealed class EqualsToBoolConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        string.Equals(value?.ToString(), parameter?.ToString(), StringComparison.Ordinal);

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true ? parameter ?? Binding.DoNothing : Binding.DoNothing;
}

/// <summary>
/// WPF no deja enlazar la clave de un PasswordBox por seguridad. Esta propiedad
/// adjunta hace el puente sin dejar la clave en el arbol visual.
/// </summary>
public static class PasswordBoxAssistant
{
    public static readonly DependencyProperty BoundPasswordProperty = DependencyProperty.RegisterAttached(
        "BoundPassword", typeof(string), typeof(PasswordBoxAssistant),
        new FrameworkPropertyMetadata(string.Empty, OnBoundPasswordChanged));

    private static readonly DependencyProperty UpdatingProperty = DependencyProperty.RegisterAttached(
        "Updating", typeof(bool), typeof(PasswordBoxAssistant), new PropertyMetadata(false));

    public static string GetBoundPassword(DependencyObject element) => (string)element.GetValue(BoundPasswordProperty);

    public static void SetBoundPassword(DependencyObject element, string value) => element.SetValue(BoundPasswordProperty, value);

    private static void OnBoundPasswordChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        if (sender is not PasswordBox box) return;

        box.PasswordChanged -= OnPasswordChanged;
        if (!(bool)box.GetValue(UpdatingProperty))
        {
            var value = args.NewValue as string ?? string.Empty;
            if (box.Password != value) box.Password = value;
        }
        box.PasswordChanged += OnPasswordChanged;
    }

    private static void OnPasswordChanged(object sender, RoutedEventArgs args)
    {
        if (sender is not PasswordBox box) return;
        box.SetValue(UpdatingProperty, true);
        SetBoundPassword(box, box.Password);
        box.SetValue(UpdatingProperty, false);
    }
}

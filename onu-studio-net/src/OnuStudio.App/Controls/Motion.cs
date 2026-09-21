using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using Point = System.Windows.Point;
using Size = System.Windows.Size;

namespace OnuStudio.App.Controls;

/// <summary>
/// Animaciones reutilizables como propiedades adjuntas, para que las vistas solo
/// declaren "esto entra suave" o "esto late" sin escribir guiones de animacion.
/// </summary>
public static class Motion
{
    private static readonly IEasingFunction EaseOut = new CubicEase { EasingMode = EasingMode.EaseOut };

    // ─────────── Entrada: aparece con un fundido y un leve desplazamiento ───────────

    public static readonly DependencyProperty EntranceProperty = DependencyProperty.RegisterAttached(
        "Entrance", typeof(bool), typeof(Motion), new PropertyMetadata(false, OnEntranceChanged));

    public static bool GetEntrance(DependencyObject element) => (bool)element.GetValue(EntranceProperty);
    public static void SetEntrance(DependencyObject element, bool value) => element.SetValue(EntranceProperty, value);

    /// <summary>Distancia en pixeles desde la que llega el elemento (Y positiva = desde abajo).</summary>
    public static readonly DependencyProperty OffsetYProperty = DependencyProperty.RegisterAttached(
        "OffsetY", typeof(double), typeof(Motion), new PropertyMetadata(14.0));

    public static double GetOffsetY(DependencyObject element) => (double)element.GetValue(OffsetYProperty);
    public static void SetOffsetY(DependencyObject element, double value) => element.SetValue(OffsetYProperty, value);

    public static readonly DependencyProperty OffsetXProperty = DependencyProperty.RegisterAttached(
        "OffsetX", typeof(double), typeof(Motion), new PropertyMetadata(0.0));

    public static double GetOffsetX(DependencyObject element) => (double)element.GetValue(OffsetXProperty);
    public static void SetOffsetX(DependencyObject element, double value) => element.SetValue(OffsetXProperty, value);

    private static void OnEntranceChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        if (sender is not FrameworkElement element) return;
        element.IsVisibleChanged -= OnVisibleChanged;
        element.Loaded -= OnLoaded;
        if (args.NewValue is not true) return;
        element.IsVisibleChanged += OnVisibleChanged;
        element.Loaded += OnLoaded;
    }

    private static void OnLoaded(object sender, RoutedEventArgs args)
    {
        if (sender is FrameworkElement { IsVisible: true } element) PlayEntrance(element);
    }

    private static void OnVisibleChanged(object sender, DependencyPropertyChangedEventArgs args)
    {
        if (args.NewValue is true && sender is FrameworkElement element) PlayEntrance(element);
    }

    public static void PlayEntrance(FrameworkElement element)
    {
        var translate = element.RenderTransform as TranslateTransform;
        if (translate is null || translate.IsFrozen)
        {
            translate = new TranslateTransform();
            element.RenderTransform = translate;
        }

        var duration = TimeSpan.FromMilliseconds(260);
        element.BeginAnimation(UIElement.OpacityProperty,
            new DoubleAnimation(0, 1, duration) { EasingFunction = EaseOut });
        translate.BeginAnimation(TranslateTransform.YProperty,
            new DoubleAnimation(GetOffsetY(element), 0, duration) { EasingFunction = EaseOut });
        translate.BeginAnimation(TranslateTransform.XProperty,
            new DoubleAnimation(GetOffsetX(element), 0, duration) { EasingFunction = EaseOut });
    }

    // ─────────── Valor suave: la barra de progreso avanza sin saltos ───────────

    public static readonly DependencyProperty SmoothValueProperty = DependencyProperty.RegisterAttached(
        "SmoothValue", typeof(double), typeof(Motion), new PropertyMetadata(0.0, OnSmoothValueChanged));

    public static double GetSmoothValue(DependencyObject element) => (double)element.GetValue(SmoothValueProperty);
    public static void SetSmoothValue(DependencyObject element, double value) => element.SetValue(SmoothValueProperty, value);

    private static void OnSmoothValueChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        if (sender is not RangeBase range) return;
        var target = (double)args.NewValue;
        // Al reiniciar (volver a 0) no tiene sentido animar hacia atras.
        if (target <= 0 || target < range.Value)
        {
            range.BeginAnimation(RangeBase.ValueProperty, null);
            range.Value = target;
            return;
        }
        range.BeginAnimation(RangeBase.ValueProperty,
            new DoubleAnimation(target, TimeSpan.FromMilliseconds(450)) { EasingFunction = EaseOut });
    }

    // ─────────── Latido: indicadores "en vivo" ───────────

    public static readonly DependencyProperty PulseProperty = DependencyProperty.RegisterAttached(
        "Pulse", typeof(bool), typeof(Motion), new PropertyMetadata(false, OnPulseChanged));

    public static bool GetPulse(DependencyObject element) => (bool)element.GetValue(PulseProperty);
    public static void SetPulse(DependencyObject element, bool value) => element.SetValue(PulseProperty, value);

    private static void OnPulseChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        if (sender is not UIElement element) return;
        if (args.NewValue is true)
        {
            element.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, 0.35, TimeSpan.FromMilliseconds(900))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            });
        }
        else
        {
            element.BeginAnimation(UIElement.OpacityProperty, null);
        }
    }
}

/// <summary>Indicador de trabajo en curso: un arco que gira.</summary>
public sealed class Spinner : Control
{
    private readonly RotateTransform _rotation = new();

    static Spinner()
    {
        WidthProperty.OverrideMetadata(typeof(Spinner), new FrameworkPropertyMetadata(18.0));
        HeightProperty.OverrideMetadata(typeof(Spinner), new FrameworkPropertyMetadata(18.0));
        FocusableProperty.OverrideMetadata(typeof(Spinner), new FrameworkPropertyMetadata(false));
    }

    public Spinner()
    {
        IsVisibleChanged += (_, args) => Animate(args.NewValue is true);
        Loaded += (_, _) => Animate(IsVisible);
        Unloaded += (_, _) => Animate(false);
    }

    protected override Visual GetVisualChild(int index) => _arc ??= BuildArc();
    protected override int VisualChildrenCount => 1;

    private Ellipse? _arc;

    private Ellipse BuildArc()
    {
        var arc = new Ellipse
        {
            StrokeThickness = 2.4,
            StrokeDashArray = new DoubleCollection { 8, 5 },
            StrokeDashCap = PenLineCap.Round,
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = _rotation,
        };
        arc.SetBinding(Shape.StrokeProperty, new System.Windows.Data.Binding(nameof(Foreground)) { Source = this });
        AddVisualChild(arc);
        return arc;
    }

    protected override Size MeasureOverride(Size constraint)
    {
        var arc = _arc ?? (Ellipse)GetVisualChild(0);
        arc.Measure(constraint);
        return new Size(Width, Height);
    }

    protected override Size ArrangeOverride(Size arrangeBounds)
    {
        var arc = _arc ?? (Ellipse)GetVisualChild(0);
        arc.Arrange(new Rect(arrangeBounds));
        return arrangeBounds;
    }

    private void Animate(bool running)
    {
        _rotation.BeginAnimation(RotateTransform.AngleProperty, running
            ? new DoubleAnimation(0, 360, TimeSpan.FromMilliseconds(900)) { RepeatBehavior = RepeatBehavior.Forever }
            : null);
    }
}

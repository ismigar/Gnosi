<?php

use Twig\Environment;
use Twig\Error\LoaderError;
use Twig\Error\RuntimeError;
use Twig\Extension\CoreExtension;
use Twig\Extension\SandboxExtension;
use Twig\Markup;
use Twig\Sandbox\SecurityError;
use Twig\Sandbox\SecurityNotAllowedTagError;
use Twig\Sandbox\SecurityNotAllowedFilterError;
use Twig\Sandbox\SecurityNotAllowedFunctionError;
use Twig\Source;
use Twig\Template;
use Twig\TemplateWrapper;

/* @help_topics/responsive_image.style.html.twig */
class __TwigTemplate_475ea53ddeb23021d1b8efc8786d87a3 extends Template
{
    private Source $source;
    /**
     * @var array<string, Template>
     */
    private array $macros = [];

    public function __construct(Environment $env)
    {
        parent::__construct($env);

        $this->source = $this->getSourceContext();

        $this->parent = false;

        $this->blocks = [
        ];
        $this->sandbox = $this->extensions[SandboxExtension::class];
        $this->checkSecurity();
    }

    protected function doDisplay(array $context, array $blocks = []): iterable
    {
        $macros = $this->macros;
        // line 10
        $context["media_topic"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getTopicLink("core.media"));
        // line 11
        $context["image_style_topic"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getTopicLink("image.style"));
        // line 12
        $context["breakpoint_overview_topic"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getTopicLink("breakpoint.overview"));
        // line 13
        $context["styles_link_text"] = ('' === $tmp = \Twig\Extension\CoreExtension::captureOutput((function () use (&$context, $macros, $blocks) {
            yield t("Responsive image styles", array());
            yield from [];
        })())) ? '' : new Markup($tmp, $this->env->getCharset());
        // line 14
        $context["styles_link"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getRouteLink(($context["styles_link_text"] ?? null), "entity.responsive_image_style.collection"));
        // line 15
        yield "<h2>";
        yield t("Goal", array());
        yield "</h2>
<p>";
        // line 16
        yield t("Configure a responsive image style, which can be used to display images at different sizes on different devices. See @media_topic for an overview of responsive image styles, and @breakpoint_overview_topic for an overview of breakpoints.", array("@media_topic" => ($context["media_topic"] ?? null), "@breakpoint_overview_topic" => ($context["breakpoint_overview_topic"] ?? null), ));
        yield "</p>
<h2>";
        // line 17
        yield t("Steps", array());
        yield "</h2>
<ol>
  <li>";
        // line 19
        yield t("In the <em>Manage</em> administrative menu, navigate to <em>Configuration</em> &gt; <em>Media</em> &gt; <em>@styles_link</em>.", array("@styles_link" => ($context["styles_link"] ?? null), ));
        yield "</li>
  <li>";
        // line 20
        yield t("Click <em>Add responsive image style</em>.", array());
        yield "</li>
  <li>";
        // line 21
        yield t("Enter a descriptive <em>Label</em> for your style.", array());
        yield "</li>
  <li>";
        // line 22
        yield t("Select a <em>Breakpoint group</em> from the groups defined by your installed themes and modules.", array());
        yield "</li>
  <li>";
        // line 23
        yield t("Select a <em>Fallback image style</em> to use when none of the other styles apply. See @image_style_topic if you need to add a new style.", array("@image_style_topic" => ($context["image_style_topic"] ?? null), ));
        yield "</li>
  <li>";
        // line 24
        yield t("Click <em>Save</em>.", array());
        yield "</li>
  <li>";
        // line 25
        yield t("On the next page, locate the fieldsets for the breakpoints provided by the selected <em>Breakpoint group</em>.", array());
        yield "</li>
  <li>";
        // line 26
        yield t("For each breakpoint that you want to use, expand the corresponding fieldset. Select the <em>Select a single image style.</em> radio button under <em>Type</em> for the breakpoint, and select the <em>Image style</em> to use for images when that breakpoint is in effect. Repeat this step for the rest of the breakpoints you want to use.", array());
        yield "</li>
  <li>";
        // line 27
        yield t("Click <em>Save</em>", array());
        yield "</li>
  <li>";
        // line 28
        yield t("You can now use this responsive image style to format a field containing an image, in your layouts or traditional field displays. See related topics below for more information.", array());
        yield "</li>
</ol>";
        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "@help_topics/responsive_image.style.html.twig";
    }

    /**
     * @codeCoverageIgnore
     */
    public function isTraitable(): bool
    {
        return false;
    }

    /**
     * @codeCoverageIgnore
     */
    public function getDebugInfo(): array
    {
        return array (  107 => 28,  103 => 27,  99 => 26,  95 => 25,  91 => 24,  87 => 23,  83 => 22,  79 => 21,  75 => 20,  71 => 19,  66 => 17,  62 => 16,  57 => 15,  55 => 14,  50 => 13,  48 => 12,  46 => 11,  44 => 10,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "@help_topics/responsive_image.style.html.twig", "/home/ismigar/webapps/web/web/core/modules/responsive_image/help_topics/responsive_image.style.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["set" => 10, "trans" => 13];
        static $filters = ["escape" => 16];
        static $functions = ["render_var" => 10, "help_topic_link" => 10, "help_route_link" => 14];

        try {
            $this->sandbox->checkSecurity(
                ['set', 'trans'],
                ['escape'],
                ['render_var', 'help_topic_link', 'help_route_link'],
                $this->source
            );
        } catch (SecurityError $e) {
            $e->setSourceContext($this->source);

            if ($e instanceof SecurityNotAllowedTagError && isset($tags[$e->getTagName()])) {
                $e->setTemplateLine($tags[$e->getTagName()]);
            } elseif ($e instanceof SecurityNotAllowedFilterError && isset($filters[$e->getFilterName()])) {
                $e->setTemplateLine($filters[$e->getFilterName()]);
            } elseif ($e instanceof SecurityNotAllowedFunctionError && isset($functions[$e->getFunctionName()])) {
                $e->setTemplateLine($functions[$e->getFunctionName()]);
            }

            throw $e;
        }

    }
}

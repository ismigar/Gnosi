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

/* @help_topics/config_translation.overview.html.twig */
class __TwigTemplate_98ccdb47ece5ea5d40a34c0bb51f2924 extends Template
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
        // line 8
        $context["config_translation_link_text"] = ('' === $tmp = \Twig\Extension\CoreExtension::captureOutput((function () use (&$context, $macros, $blocks) {
            yield t("Configuration translation", array());
            yield from [];
        })())) ? '' : new Markup($tmp, $this->env->getCharset());
        // line 9
        $context["config_translation_link"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getRouteLink(($context["config_translation_link_text"] ?? null), "config_translation.mapper_list"));
        // line 10
        $context["config_overview_topic"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getTopicLink("core.config_overview"));
        // line 11
        $context["language_add_topic"] = $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($this->extensions['Drupal\help\HelpTwigExtension']->getTopicLink("language.add"));
        // line 12
        yield "<h2>";
        yield t("Goal", array());
        yield "</h2>
<p>";
        // line 13
        yield t("Translate your site configuration to another language. See @language_add_topic if you need to add a new language.", array("@language_add_topic" => ($context["language_add_topic"] ?? null), ));
        yield "</p>
<h2>";
        // line 14
        yield t("Steps", array());
        yield "</h2>
<ol>
  <li>";
        // line 16
        yield t("In the <em>Manage</em> administrative menu, navigate to <em>Configuration</em> &gt; <em>Region and language</em> &gt; <em>@config_translation_link</em>.", array("@config_translation_link" => ($context["config_translation_link"] ?? null), ));
        yield "</li>
  <li>";
        // line 17
        yield t("Find either the configuration entity type or the simple configuration item that you want to translate in the <em>Label</em> column of the list. Click <em>List</em> under <em>Operations</em> for a configuration entity, or <em>Translate</em> for simple configuration. (See @config_overview_topic to learn more about types of configuration and configuration entities.)", array("@config_overview_topic" => ($context["config_overview_topic"] ?? null), ));
        yield "</li>
  <li>";
        // line 18
        yield t("For configuration entities, find the specific entity that you want to translate on the next page, and click <em>Translate</em> under <em>Operations</em>.", array());
        yield "</li>
  <li>";
        // line 19
        yield t("Enter translations for the translatable text fields for the configuration item, and save.", array());
        yield "</li>
</ol>";
        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "@help_topics/config_translation.overview.html.twig";
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
        return array (  81 => 19,  77 => 18,  73 => 17,  69 => 16,  64 => 14,  60 => 13,  55 => 12,  53 => 11,  51 => 10,  49 => 9,  44 => 8,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "@help_topics/config_translation.overview.html.twig", "/home/ismigar/webapps/web/web/core/modules/config_translation/help_topics/config_translation.overview.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["set" => 8, "trans" => 8];
        static $filters = ["escape" => 13];
        static $functions = ["render_var" => 9, "help_route_link" => 9, "help_topic_link" => 10];

        try {
            $this->sandbox->checkSecurity(
                ['set', 'trans'],
                ['escape'],
                ['render_var', 'help_route_link', 'help_topic_link'],
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

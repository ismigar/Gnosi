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

/* themes/custom/elraco/templates/views/views-view-field--col_laboren--block--field-image.html.twig */
class __TwigTemplate_e73cd34751f7be828e201bb9ff39de4e extends Template
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
        // line 2
        yield "
";
        // line 4
        $context["link_list"] = (((CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, ($context["row"] ?? null), "_entity", [], "any", false, true, true, 4), "field_enllac", [], "any", true, true, true, 4) &&  !(null === CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, ($context["row"] ?? null), "_entity", [], "any", false, false, true, 4), "field_enllac", [], "any", false, false, true, 4)))) ? (CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, ($context["row"] ?? null), "_entity", [], "any", false, false, true, 4), "field_enllac", [], "any", false, false, true, 4)) : (null));
        // line 5
        yield "
";
        // line 7
        $context["link_item"] = (((($context["link_list"] ?? null) && (Twig\Extension\CoreExtension::length($this->env->getCharset(), ($context["link_list"] ?? null)) > 0))) ? ((($_v0 = ($context["link_list"] ?? null)) && is_array($_v0) || $_v0 instanceof ArrayAccess && in_array($_v0::class, CoreExtension::ARRAY_LIKE_CLASSES, true) ? ($_v0[0] ?? null) : CoreExtension::getAttribute($this->env, $this->source, ($context["link_list"] ?? null), 0, [], "array", false, false, true, 7))) : (null));
        // line 8
        yield "
";
        // line 10
        $context["href"] = ((($context["link_item"] ?? null)) ? ((((CoreExtension::getAttribute($this->env, $this->source, ($context["link_item"] ?? null), "uri", [], "any", true, true, true, 10) &&  !(null === CoreExtension::getAttribute($this->env, $this->source, ($context["link_item"] ?? null), "uri", [], "any", false, false, true, 10)))) ? (CoreExtension::getAttribute($this->env, $this->source, ($context["link_item"] ?? null), "uri", [], "any", false, false, true, 10)) : (""))) : (""));
        // line 11
        yield "
";
        // line 13
        if ((is_string($_v1 = ($context["href"] ?? null)) && is_string($_v2 = "internal:") && str_starts_with($_v1, $_v2))) {
            // line 14
            yield "  ";
            $context["href"] = Twig\Extension\CoreExtension::replace(($context["href"] ?? null), ["internal:" => ""]);
        }
        // line 16
        yield "
";
        // line 18
        if (($context["href"] ?? null)) {
            // line 19
            yield "  <a href=\"";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["href"] ?? null), "html", null, true);
            yield "\" target=\"_blank\" rel=\"noopener\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["output"] ?? null), "html", null, true);
            yield "</a>
";
        } else {
            // line 21
            yield "  ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["output"] ?? null), "html", null, true);
            yield "
";
        }
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["row", "output"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/custom/elraco/templates/views/views-view-field--col_laboren--block--field-image.html.twig";
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
        return array (  81 => 21,  73 => 19,  71 => 18,  68 => 16,  64 => 14,  62 => 13,  59 => 11,  57 => 10,  54 => 8,  52 => 7,  49 => 5,  47 => 4,  44 => 2,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/custom/elraco/templates/views/views-view-field--col_laboren--block--field-image.html.twig", "/home/ismigar/webapps/web/web/themes/custom/elraco/templates/views/views-view-field--col_laboren--block--field-image.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["set" => 4, "if" => 13];
        static $filters = ["length" => 7, "replace" => 14, "escape" => 19];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['set', 'if'],
                ['length', 'replace', 'escape'],
                [],
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
